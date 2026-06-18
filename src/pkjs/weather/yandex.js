var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;

var YANDEX_API_URL = 'https://api.weather.yandex.ru/graphql/query';
var OPEN_METEO_API_URL = 'https://api.open-meteo.com/v1/forecast';
var UV_UNAVAILABLE = null;

var YANDEX_QUERY = [
    '{',
    '  serverTime',
    '  weatherByPoint(request: { lat: LATITUDE, lon: LONGITUDE }) {',
    '    now {',
    '      temperature',
    '      feelsLike',
    '      condition',
    '      icon(format: PNG_64)',
    '      windSpeed',
    '    }',
    '    forecast {',
    '      days {',
    '        hours {',
    '          time',
    '          temperature',
    '          feelsLike',
    '          condition',
    '          icon(format: PNG_64)',
    '          windSpeed',
    '        }',
    '      }',
    '    }',
    '  }',
    '}'
].join('\n');

/**
 * Convert Celsius to Fahrenheit for the watch-side temperature setting flow.
 *
 * @param {number} tempC Temperature in Celsius.
 * @returns {number} Temperature in Fahrenheit.
 */
function celsiusToFahrenheit(tempC) {
    return tempC * 9 / 5 + 32;
}

/**
 * Convert an ISO timestamp to Unix seconds.
 *
 * @param {string} value ISO timestamp.
 * @returns {number|null} Unix seconds, or null when invalid.
 */
function parseUnixSeconds(value) {
    var timestamp = Date.parse(value);

    if (!isFinite(timestamp)) {
        return null;
    }

    return Math.floor(timestamp / 1000);
}

/**
 * Round a Date down to the nearest hour as Unix seconds.
 *
 * @param {Date} date Date to round.
 * @returns {number} Unix seconds.
 */
function roundDownHourUnixSeconds(date) {
    var rounded = new Date(date.getTime());
    rounded.setMinutes(0);
    rounded.setSeconds(0);
    rounded.setMilliseconds(0);
    return Math.floor(rounded.getTime() / 1000);
}

/**
 * Build the fixed hourly graph window used by the watch.
 *
 * @param {number} startTime Unix seconds for the first graph hour.
 * @param {number} numEntries Number of hourly entries.
 * @returns {number[]} Unix-second timestamps, one per graph entry.
 */
function buildHourlyWindow(startTime, numEntries) {
    var times = [];
    var index;

    for (index = 0; index < numEntries; index += 1) {
        times.push(startTime + index * 60 * 60);
    }

    return times;
}

/**
 * Convert an Open-Meteo hour to Unix seconds.
 *
 * @param {string|number} value Open-Meteo hour value.
 * @returns {number|null} Unix seconds, or null when invalid.
 */
function parseOpenMeteoUnixSeconds(value) {
    var timestamp;

    if (typeof value === 'number' && isFinite(value)) {
        return Math.floor(value);
    }

    timestamp = Date.parse(value);
    if (!isFinite(timestamp)) {
        return null;
    }

    return Math.floor(timestamp / 1000);
}

/**
 * Normalize Yandex GraphQL hourly forecast entries.
 *
 * @param {Object} weatherData Parsed GraphQL response.
 * @returns {{time: number, temp: number}[]} Sorted forecast entries.
 */
function getHourlyForecast(weatherData) {
    var weatherByPoint = weatherData && weatherData.weatherByPoint;
    var forecast = weatherByPoint && weatherByPoint.forecast;
    var days = forecast && forecast.days;
    var hourly = [];
    var nowSeconds = Math.floor(Date.now() / 1000);

    if (!Array.isArray(days)) {
        return hourly;
    }

    days.forEach(function(day) {
        var hours = day && day.hours;
        if (!Array.isArray(hours)) {
            return;
        }

        hours.forEach(function(hour) {
            var time;
            if (!hour || typeof hour.temperature !== 'number') {
                return;
            }

            time = parseUnixSeconds(hour.time);
            if (time === null || time < nowSeconds - 3600) {
                return;
            }

            hourly.push({
                time: time,
                temp: celsiusToFahrenheit(hour.temperature)
            });
        });
    });

    hourly.sort(function(a, b) {
        return a.time - b.time;
    });

    return hourly;
}

/**
 * Build a lookup table for Open-Meteo hourly values by Unix timestamp.
 *
 * @param {Object} openMeteoData Parsed Open-Meteo response.
 * @returns {Object} Forecast supplement by Unix timestamp.
 */
function getOpenMeteoByTime(openMeteoData) {
    var hourly = openMeteoData && openMeteoData.hourly;
    var times = hourly && hourly.time;
    var precipProbabilities = hourly && hourly.precipitation_probability;
    var uvIndices = hourly && hourly.uv_index;
    var byTime = {};

    if (!Array.isArray(times)) {
        return byTime;
    }

    times.forEach(function(timeValue, index) {
        var timestamp = parseOpenMeteoUnixSeconds(timeValue);
        var precipProbability;
        var uvIndex;

        if (timestamp === null) {
            return;
        }

        precipProbability = Array.isArray(precipProbabilities)
            ? precipProbabilities[index]
            : null;
        uvIndex = Array.isArray(uvIndices)
            ? uvIndices[index]
            : null;

        byTime[timestamp] = {
            precipProbability: typeof precipProbability === 'number'
                ? Math.max(0, Math.min(1, precipProbability / 100))
                : 0,
            uvIndex: typeof uvIndex === 'number' ? uvIndex : UV_UNAVAILABLE
        };
    });

    return byTime;
}

/**
 * Build hourly temperature values for the fixed graph window.
 *
 * @param {{time: number, temp: number}[]} hourly Yandex hourly entries.
 * @param {number[]} windowTimes Fixed graph window timestamps.
 * @param {number} fallbackTemp Temperature to use when no forecast point exists.
 * @returns {number[]} Temperature trend values.
 */
function getTempTrendForWindow(hourly, windowTimes, fallbackTemp) {
    var byTime = {};
    var trend = [];
    var lastTemp = fallbackTemp;

    hourly.forEach(function(entry) {
        byTime[entry.time] = entry.temp;
    });

    windowTimes.forEach(function(windowTime) {
        if (typeof byTime[windowTime] === 'number') {
            lastTemp = byTime[windowTime];
        }
        trend.push(lastTemp);
    });

    return trend;
}

var YandexProvider = function(apiKey) {
    this._super.call(this);
    this.name = 'Yandex Weather';
    this.id = 'yandex';
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : apiKey;
};

YandexProvider.prototype = Object.create(WeatherProvider.prototype);
YandexProvider.prototype.constructor = YandexProvider;
YandexProvider.prototype._super = WeatherProvider;

/**
 * Fetch Yandex Weather GraphQL data for the given point.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {Function} callback Callback with the parsed response data.
 * @param {Function} onFailure Failure callback.
 * @returns {void}
 */
YandexProvider.prototype.withYandexResponse = function(lat, lon, callback, onFailure) {
    var query;

    if (!this.apiKey) {
        onFailure({ stage: 'provider_data', code: 'yandex_missing_api_key' });
        return;
    }

    query = YANDEX_QUERY
        .replace('LATITUDE', String(lat))
        .replace('LONGITUDE', String(lon));

    console.log('Requesting ' + YANDEX_API_URL);

    request(
        YANDEX_API_URL,
        'POST',
        function(response) {
            var body;
            try {
                body = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'yandex_parse_error' });
                return;
            }

            if (body && Array.isArray(body.errors) && body.errors.length > 0) {
                console.log('[!] Yandex Weather errors: ' + JSON.stringify(body.errors));
                onFailure({ stage: 'provider_data', code: 'yandex_graphql_error' });
                return;
            }

            if (!body || !body.data || !body.data.weatherByPoint || !body.data.weatherByPoint.now) {
                onFailure({ stage: 'provider_data', code: 'yandex_missing_fields' });
                return;
            }

            callback(body.data);
        },
        function(error) {
            console.log('[!] Yandex Weather request failed: ' + JSON.stringify(error));
            onFailure({ stage: 'provider_data', code: 'yandex_' + error.code });
        },
        {
            body: JSON.stringify({ query: query }),
            headers: {
                'Content-Type': 'application/json',
                'X-Yandex-Weather-Key': this.apiKey
            }
        }
    );
};

/**
 * Fetch Open-Meteo precipitation probability and UV index for the same point.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {Function} callback Callback with the parsed response data.
 * @param {Function} onFailure Failure callback.
 * @returns {void}
 */
YandexProvider.prototype.withOpenMeteoResponse = function(lat, lon, callback, onFailure) {
    var url = OPEN_METEO_API_URL
        + '?latitude=' + encodeURIComponent(lat)
        + '&longitude=' + encodeURIComponent(lon)
        + '&hourly=precipitation_probability,uv_index'
        + '&forecast_days=2'
        + '&timeformat=unixtime'
        + '&timezone=auto';

    console.log('Requesting ' + OPEN_METEO_API_URL + ' for Yandex supplement');

    request(
        url,
        'GET',
        function(response) {
            var body;
            try {
                body = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'openmeteo_parse_error' });
                return;
            }

            if (!body || !body.hourly || !Array.isArray(body.hourly.time)) {
                onFailure({ stage: 'provider_data', code: 'openmeteo_missing_fields' });
                return;
            }

            callback(body);
        },
        function(error) {
            console.log('[!] Open-Meteo supplement request failed: ' + JSON.stringify(error));
            onFailure({ stage: 'provider_data', code: 'openmeteo_' + error.code });
        }
    );
};

YandexProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    console.log('This is the Yandex Weather implementation of withProviderData');
    this.withYandexResponse(lat, lon, (function(weatherData) {
        var now = weatherData.weatherByPoint.now;
        var currentTemp;
        var hourly;
        var graphStartTime;
        var graphWindowTimes;
        var finishWithSupplement;

        if (typeof now.temperature !== 'number') {
            onFailure({ stage: 'provider_data', code: 'yandex_current_temp_missing' });
            return;
        }

        currentTemp = celsiusToFahrenheit(now.temperature);
        hourly = getHourlyForecast(weatherData);
        graphStartTime = roundDownHourUnixSeconds(new Date());
        graphWindowTimes = buildHourlyWindow(graphStartTime, this.numEntries);

        this.startTime = graphStartTime;
        this.tempTrend = getTempTrendForWindow(hourly, graphWindowTimes, currentTemp);
        this.currentTemp = currentTemp;

        finishWithSupplement = (function(openMeteoData) {
            var openMeteoByTime = openMeteoData ? getOpenMeteoByTime(openMeteoData) : {};
            var index;
            var supplement;

            this.precipTrend = [];
            this.uvTrend = [];
            for (index = 0; index < this.numEntries; index += 1) {
                supplement = openMeteoByTime[graphWindowTimes[index]];

                this.precipTrend.push(supplement ? supplement.precipProbability : 0);
                this.uvTrend.push(supplement ? supplement.uvIndex : UV_UNAVAILABLE);
            }

            onSuccess();
        }).bind(this);

        this.withOpenMeteoResponse(lat, lon, finishWithSupplement, function(error) {
            console.log('Open-Meteo supplement unavailable: ' + JSON.stringify(error));
            finishWithSupplement(null);
        });
    }).bind(this), onFailure);
};

module.exports = YandexProvider;
