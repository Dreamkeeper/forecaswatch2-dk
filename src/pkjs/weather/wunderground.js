var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;

var WundergroundProvider = function() {
    this._super.call(this);
    this.name = 'Weather Underground';
    this.id = 'wunderground';
};

WundergroundProvider.prototype = Object.create(WeatherProvider.prototype);
WundergroundProvider.prototype.constructor = WundergroundProvider;
WundergroundProvider.prototype._super = WeatherProvider;

WundergroundProvider.prototype.withWundergroundForecast = function(lat, lon, apiKey, callback, onFailure) {
    // callback(wundergroundResponse)
    var url = 'https://api.weather.com/v1/geocode/' + lat + '/' + lon + '/forecast/hourly/48hour.json?apiKey=' + apiKey + '&language=en-US';

    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'wu_forecast_parse_error' });
                return;
            }

            if (!weatherData || !Array.isArray(weatherData.forecasts) || weatherData.forecasts.length === 0) {
                onFailure({ stage: 'provider_data', code: 'wu_forecast_missing_fields' });
                return;
            }

            callback(weatherData.forecasts);
        },
        function(error) {
            onFailure({ stage: 'provider_data', code: 'wu_forecast_' + error.code });
        }
    );
};

WundergroundProvider.prototype.withWundergroundCurrent = function(lat, lon, apiKey, callback, onFailure) {
    // callback(wundergroundResponse)
    var url = 'https://api.weather.com/v3/wx/observations/current?language=en-US&units=e&format=json'
        + '&apiKey=' + apiKey
        + '&geocode=' + lat + ',' + lon;

    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        (function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'wu_current_parse_error' });
                return;
            }

            if (!weatherData || typeof weatherData.temperature !== 'number') {
                onFailure({ stage: 'provider_data', code: 'wu_current_missing_fields' });
                return;
            }

            callback(weatherData.temperature);
        }).bind(this),
        function(error) {
            onFailure({ stage: 'provider_data', code: 'wu_current_' + error.code });
        }
    );
};

/**
 * Fetch hourly UV indices from The Weather Company.
 *
 * @param {string} lat Latitude.
 * @param {string} lon Longitude.
 * @param {string} apiKey Weather Company API key.
 * @param {Function} callback Callback with the hourly UV response.
 * @param {Function} onFailure Callback with normalized error details.
 * @returns {void}
 */
WundergroundProvider.prototype.withWundergroundUv = function(lat, lon, apiKey, callback, onFailure) {
    var url = 'https://api.weather.com/v2/indices/uv/hourly/48hour?language=en-US&format=json'
        + '&apiKey=' + apiKey
        + '&geocode=' + lat + ',' + lon;

    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'wu_uv_parse_error' });
                return;
            }

            if (!weatherData || !weatherData.uvIndex1hour
                || !Array.isArray(weatherData.uvIndex1hour.fcstValid)
                || !Array.isArray(weatherData.uvIndex1hour.uvIndex)) {
                onFailure({ stage: 'provider_data', code: 'wu_uv_missing_fields' });
                return;
            }

            callback(weatherData.uvIndex1hour);
        },
        function(error) {
            onFailure({ stage: 'provider_data', code: 'wu_uv_' + error.code });
        }
    );
};

WundergroundProvider.prototype.clearApiKey = function() {
    localStorage.removeItem('wundergroundApiKey');
    console.log('Cleared API key');
};

WundergroundProvider.prototype.withApiKey = function(callback, onFailure) {
    // callback(apiKey)

    var apiKey = localStorage.getItem('wundergroundApiKey');
    var url = 'https://www.wunderground.com/';

    if (apiKey === null) {
        console.log('Fetching Weather Underground API key');

        request(
            url,
            'GET',
            function(response) {
                var match = response.match(/observations\/current\?apiKey=([a-z0-9]*)/);
                if (!match || !match[1]) {
                    onFailure({ stage: 'provider_data', code: 'wu_api_key_not_found' });
                    return;
                }

                apiKey = match[1];
                localStorage.setItem('wundergroundApiKey', apiKey);
                console.log('Fetched Weather Underground API key: ' + apiKey);
                callback(apiKey);
            },
            function(error) {
                onFailure({ stage: 'provider_data', code: 'wu_api_key_' + error.code });
            }
        );
    }
    else {
        console.log('Using saved API key for Weather Underground');
        callback(apiKey);
    }
};

// ============== IMPORTANT OVERRIDE ================

WundergroundProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // onSuccess expects that this.hasValidData() will be true
    var currentTemp;
    var forecast;
    var uvData;
    var currentReady = false;
    var forecastReady = false;
    var uvReady = false;
    var failed = false;

    if (force) {
        // In case the API key becomes invalid
        console.log('Clearing Weather Underground API key for forced update');
        this.clearApiKey();
    }

    this.withApiKey((function(apiKey) {
        var failOnce = function(error) {
            if (failed) {
                return;
            }
            failed = true;
            onFailure(error);
        };
        var complete = (function() {
            var uvByTime = {};

            if (failed || !currentReady || !forecastReady || !uvReady) {
                return;
            }

            if (uvData) {
                uvData.fcstValid.forEach(function(timestamp, index) {
                    uvByTime[timestamp] = uvData.uvIndex[index];
                });
            }

            this.tempTrend = forecast.map(function(entry) {
                return entry.temp;
            });
            this.precipTrend = forecast.map(function(entry) {
                return entry.pop / 100.0;
            });
            this.uvTrend = forecast.map(function(entry) {
                return uvByTime.hasOwnProperty(entry.fcst_valid)
                    ? uvByTime[entry.fcst_valid]
                    : 255;
            });
            this.startTime = forecast[0].fcst_valid;
            this.currentTemp = currentTemp;
            onSuccess();
        }).bind(this);

        this.withWundergroundCurrent(lat, lon, apiKey, function(value) {
            currentTemp = value;
            currentReady = true;
            complete();
        }, failOnce);
        this.withWundergroundForecast(lat, lon, apiKey, function(value) {
            forecast = value;
            forecastReady = true;
            complete();
        }, failOnce);
        this.withWundergroundUv(lat, lon, apiKey, function(value) {
            uvData = value;
            uvReady = true;
            complete();
        }, function(error) {
            console.log('UV forecast unavailable: ' + JSON.stringify(error));
            uvReady = true;
            complete();
        });
    }).bind(this), onFailure);
};

module.exports = WundergroundProvider;
