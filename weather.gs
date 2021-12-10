var OPEN_WEATHER_MAP_API_KEY = 'API_KEY_HERE';
var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/1c3JzTZpK0O1X-xsUELV1tAqmNt5_zHuox0UU82Wx54I/edit?usp=sharing';
var WEATHER_LOOKUP_CACHE = {};
var TARGETING = 'ALL';


function main() {
  Logger.log('Programa iniciado');

  
  validateApiKey();
  
  var spreadsheet = validateAndGetSpreadsheet(SPREADSHEET_URL);
  var campaignRuleData = getSheetData(spreadsheet, 1);
  var weatherConditionData = getSheetData(spreadsheet, 2);
  var geoMappingData = getSheetData(spreadsheet, 3);

  // Convert the data into dictionaries for convenient usage.
  var campaignMapping = buildCampaignRulesMapping(campaignRuleData);
  var weatherConditionMapping =
      buildWeatherConditionMapping(weatherConditionData);
  var locationMapping = buildLocationMapping(geoMappingData);

  // Apply the rules.
  for (var campaignName in campaignMapping) {
    Logger.log("Campanha: %s", campaignName);
    applyRulesForCampaign(campaignName, campaignMapping[campaignName],
        locationMapping, weatherConditionMapping);
  }
}


function getSheetData(spreadsheet, sheetIndex) {
  var sheet = spreadsheet.getSheets()[sheetIndex];
  var range =
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn());
  return range.getValues();
}

function buildCampaignRulesMapping(campaignRulesData) {
  var campaignMapping = {};
  for (var i = 0; i < campaignRulesData.length; i++) {
    // Skip rule if not enabled.

    if (campaignRulesData[i][5].toLowerCase() == 'yes') {
      var campaignName = campaignRulesData[i][0];
      var campaignRules = campaignMapping[campaignName] || [];
      campaignRules.push({
          'name': campaignName,

          // location for which this rule applies.
          'location': campaignRulesData[i][1],

          // the weather condition (e.g. Sunny).
          'condition': campaignRulesData[i][2],

          // bid modifier to be applied.
          'bidModifier': campaignRulesData[i][3],

          // whether bid adjustments should by applied only to geo codes
          // matching the location of the rule or to all geo codes that
          // the campaign targets.
          'targetedOnly': campaignRulesData[i][4].toLowerCase() ==
                          'matching geo targets'
      });
      campaignMapping[campaignName] = campaignRules;
    }
  }
  //Logger.log('Campaign Mapping: %s', campaignMapping);
  return campaignMapping;
}


function buildWeatherConditionMapping(weatherConditionData) {
  var weatherConditionMapping = {};

  for (var i = 0; i < weatherConditionData.length; i++) {
    var weatherConditionName = weatherConditionData[i][0];
    weatherConditionMapping[weatherConditionName] = {
      // Condition name (e.g. Sunny)
      'condition': weatherConditionName,

      // Temperature (e.g. 50 to 70)
      'temperature': weatherConditionData[i][1],

      // Precipitation (e.g. below 70)
      'precipitation': weatherConditionData[i][2],

      // Wind speed (e.g. above 5)
      'wind': weatherConditionData[i][3]
    };
  }
  //Logger.log('Weather condition mapping: %s', weatherConditionMapping);
  return weatherConditionMapping;
}

function buildLocationMapping(geoTargetData) {
  var locationMapping = {};
  for (var i = 0; i < geoTargetData.length; i++) {
    var locationName = geoTargetData[i][0];
    var locationDetails = locationMapping[locationName] || {
      'geoCodes': []      // List of geo codes understood by Google Ads scripts.
    };

    locationDetails.geoCodes.push(geoTargetData[i][1]);
    locationMapping[locationName] = locationDetails;
  }
  //Logger.log('Location Mapping: %s', locationMapping);
  return locationMapping;
}

function applyRulesForCampaign(campaignName, campaignRules, locationMapping,
                               weatherConditionMapping) {
  
  Logger.log('ammount: %s', campaignRules.length);
  for (var i = 0; i < campaignRules.length; i++) {
    var bidModifier = 1;
    var campaignRule = campaignRules[i];
    Logger.log('Rule => %s ', campaignRule);
    // Get the weather for the required location.
    var locationDetails = locationMapping[campaignRule.location];
    var weather = getWeather(campaignRule.location);
    Logger.log('Weather for %s: %s', locationDetails, weather);

    // Get the weather rules to be checked.
    var weatherConditionName = campaignRule.condition;
    var weatherConditionRules = weatherConditionMapping[weatherConditionName];

    // Evaluate the weather rules.
    if (evaluateWeatherRules(weatherConditionRules, weather)) {
      Logger.log('Campanha: %s atendeu as condições', campaignName);
      
      var ___condition = 'Name = "' + campaignName + '"';
      var campaignIterator = AdsApp.campaigns()
        .withCondition(___condition)
        .get();
      if (campaignIterator.hasNext()) {
        var campaign = campaignIterator.next();
        campaign.enable();
      }

    }
    else {
      Logger.log('Campanha: %s FOI PAUSADA POR NÃO ATENDER AS CONDIÇÕES', campaignName);
      var ___condition = 'Name = "' + campaignName + '"';
      var campaignIterator = AdsApp.campaigns()
        .withCondition(___condition)
        .get();
      if (campaignIterator.hasNext()) {
        var campaign = campaignIterator.next();
        campaign.pause();
      }
    }
    /*
        ===================== condição da qual ajustaria os bids, desabilitado! =================
        
    
    if (evaluateWeatherRules(weatherConditionRules, weather)) {
      Logger.log('Matching Rule found: Campaign Name = %s, location = %s, ' +
          'weatherName = %s,weatherRules = %s, noticed weather = %s.',
          campaignRule.name, campaignRule.location,
          weatherConditionName, weatherConditionRules, weather);
      bidModifier = campaignRule.bidModifier;

      if (TARGETING == 'LOCATION' || TARGETING == 'ALL') {
        // Get the geo codes that should have their bids adjusted.
        var geoCodes = campaignRule.targetedOnly ?
          locationDetails.geoCodes : null;
        adjustBids(campaignName, geoCodes, bidModifier);
      }

      if (TARGETING == 'PROXIMITY' || TARGETING == 'ALL') {
        var location = campaignRule.targetedOnly ? campaignRule.location : null;
        adjustProximityBids(campaignName, location, bidModifier);
      }

    }*/
    
    
  }
  return;
}

function toFahrenheit(kelvin) {
  return (kelvin - 273.15) * 1.8 + 32;
}

function evaluateWeatherRules(weatherRules, weather) {
  // See https://openweathermap.org/weather-data
  // for values returned by OpenWeatherMap API.
  var precipitation = 0;
  if (weather.rain && weather.rain['3h']) {
    precipitation = weather.rain['3h'];
  }
  var temperature = toFahrenheit(weather.main.temp);
  var windspeed = weather.wind.speed;

  return evaluateMatchRules(weatherRules.temperature, temperature) &&
      evaluateMatchRules(weatherRules.precipitation, precipitation) &&
      evaluateMatchRules(weatherRules.wind, windspeed);
}

function evaluateMatchRules(condition, value) {
  // No condition to evaluate, rule passes.
  if (condition == '') {
    return true;
  }
  var rules = [matchesBelow, matchesAbove, matchesRange];

  for (var i = 0; i < rules.length; i++) {
    if (rules[i](condition, value)) {
      return true;
    }
  }
  return false;
}

function matchesBelow(condition, value) {
  conditionParts = condition.split(' ');

  if (conditionParts.length != 2) {
    return false;
  }

  if (conditionParts[0] != 'below') {
    return false;
  }

  if (value < conditionParts[1]) {
    return true;
  }
  return false;
}

function matchesAbove(condition, value) {
  conditionParts = condition.split(' ');

  if (conditionParts.length != 2) {
    return false;
  }

  if (conditionParts[0] != 'above') {
    return false;
  }

  if (value > conditionParts[1]) {
    return true;
  }
  return false;
}

function matchesRange(condition, value) {
  conditionParts = condition.replace('\w+', ' ').split(' ');

  if (conditionParts.length != 3) {
    return false;
  }

  if (conditionParts[1] != 'to') {
    return false;
  }

  if (conditionParts[0] <= value && value <= conditionParts[2]) {
    return true;
  }
  return false;
}

function getWeather(location) {
  if (location in WEATHER_LOOKUP_CACHE) {
  
    return WEATHER_LOOKUP_CACHE[location];
  }

  var url = Utilities.formatString(
      'http://api.openweathermap.org/data/2.5/weather?APPID=%s&q=%s',
      encodeURIComponent(OPEN_WEATHER_MAP_API_KEY),
      encodeURIComponent(location));
  var response = UrlFetchApp.fetch(url);
  if (response.getResponseCode() != 200) {
    throw Utilities.formatString(
        'Error returned by API: %s, Location searched: %s.',
        response.getContentText(), location);
  }

  var result = JSON.parse(response.getContentText());

  // OpenWeatherMap's way of returning errors.
  if (result.cod != 200) {
    throw Utilities.formatString(
        'Error returned by API: %s,  Location searched: %s.',
        response.getContentText(), location);
  }

  WEATHER_LOOKUP_CACHE[location] = result;
  return result;
}

function adjustBids(campaignName, geoCodes, bidModifier) {
  // Get the campaign.
  var campaign = getCampaign(campaignName);
  if (!campaign) return null;

  // Get the targeted locations.
  var locations = campaign.targeting().targetedLocations().get();
  while (locations.hasNext()) {
    var location = locations.next();
    var currentBidModifier = location.getBidModifier().toFixed(2);

    // Apply the bid modifier only if the campaign has a custom targeting
    // for this geo location or if all locations are to be modified.
    if (!geoCodes || (geoCodes.indexOf(location.getId()) != -1 &&
      currentBidModifier != bidModifier)) {
        Logger.log('Setting bidModifier = %s for campaign name = %s, ' +
            'geoCode = %s. Old bid modifier is %s.', bidModifier,
            campaignName, location.getId(), currentBidModifier);
        location.setBidModifier(bidModifier);
    }
  }
}

function adjustProximityBids(campaignName, weatherLocation, bidModifier) {
  // Get the campaign.
  var campaign = getCampaign(campaignName);
  if(campaign === null) return;

  // Get the proximity locations.
  var proximities = campaign.targeting().targetedProximities().get();
  while (proximities.hasNext()) {
    var proximity = proximities.next();
    var currentBidModifier = proximity.getBidModifier().toFixed(2);

    // Apply the bid modifier only if the campaign has a custom targeting
    // for this geo location or if all locations are to be modified.
    if (!weatherLocation ||
        (weatherNearProximity(proximity, weatherLocation) &&
      currentBidModifier != bidModifier)) {
        Logger.log('Setting bidModifier = %s for campaign name = %s, with ' +
            'weatherLocation = %s in proximity area. Old bid modifier is %s.',
            bidModifier, campaignName, weatherLocation, currentBidModifier);
        proximity.setBidModifier(bidModifier);
      }
  }
}

function weatherNearProximity(proximity, weatherLocation) {
  // See https://en.wikipedia.org/wiki/Haversine_formula for details on how
  // to compute spherical distance.
  var earthRadiusInMiles = 3960.0;
  var degreesToRadians = Math.PI / 180.0;
  var radiansToDegrees = 180.0 / Math.PI;
  var kmToMiles = 0.621371;

  var radiusInMiles = proximity.getRadiusUnits() == 'MILES' ?
    proximity.getRadius() : proximity.getRadius() * kmToMiles;

  // Compute the change in latitude degrees for the radius.
  var deltaLat = (radiusInMiles / earthRadiusInMiles) * radiansToDegrees;
  // Find the radius of a circle around the earth at given latitude.
  var r = earthRadiusInMiles * Math.cos(proximity.getLatitude() *
      degreesToRadians);
  // Compute the change in longitude degrees for the radius.
  var deltaLon = (radiusInMiles / r) * radiansToDegrees;

  // Retrieve weather location for lat/lon coordinates.
  var weather = getWeather(weatherLocation);
  // Check if weather condition is within the proximity boundaries.
  return (weather.coord.lat >= proximity.getLatitude() - deltaLat &&
          weather.coord.lat <= proximity.getLatitude() + deltaLat &&
          weather.coord.lon >= proximity.getLongitude() - deltaLon &&
          weather.coord.lon <= proximity.getLongitude() + deltaLon);
}

function getCampaign(campaignName) {
  var selectors = [AdsApp.campaigns(), AdsApp.videoCampaigns(),
      AdsApp.shoppingCampaigns()];
  for(var i = 0; i < selectors.length; i++) {
    var campaignIter = selectors[i].
        withCondition('CampaignName = "' + campaignName + '"').
        get();
    if (campaignIter.hasNext()) {
      return campaignIter.next();
    }
  }
  return null;
}

function validateAndGetSpreadsheet(spreadsheeturl) {
  if (spreadsheeturl == 'INSERT_SPREADSHEET_URL_HERE') {
    throw new Error('Please specify a valid Spreadsheet URL. You can find' +
        ' a link to a template in the associated guide for this script.');
  }
  var spreadsheet = SpreadsheetApp.openByUrl(spreadsheeturl);
  return spreadsheet;
}

function validateApiKey() {
  if (OPEN_WEATHER_MAP_API_KEY == 'INSERT_OPEN_WEATHER_MAP_API_KEY_HERE') {
    throw new Error('Please specify a valid API key for OpenWeatherMap. You ' +
        'can acquire one here: http://openweathermap.org/appid');
  }
}
