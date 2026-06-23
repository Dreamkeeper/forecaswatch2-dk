var WeatherProvider = require('./provider.js');
var storageKeys = require('../storage-keys.js');
var request = WeatherProvider.request;

var YANDEX_API_URL = 'https://api.weather.yandex.ru/graphql/query';
var OPEN_METEO_API_URL = 'https://api.open-meteo.com/v1/forecast';
var UV_UNAVAILABLE = null;
var YANDEX_WEATHER_CACHE_KEY = storageKeys.YANDEX_WEATHER_CACHE_KEY;
var OPEN_METEO_WEATHER_CACHE_KEY = storageKeys.OPEN_METEO_WEATHER_CACHE_KEY;
var CACHE_VERSION = 1;
var OPEN_METEO_FULL_HOURLY = 'temperature_2m,precipitation_probability,uv_index';
var OPEN_METEO_SUPPLEMENT_HOURLY = 'precipitation_probability,uv_index';
var CACHE_COORDINATE_MATCH_KM = 25;

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
 * Safely parse localStorage JSON.
 *
 * @param {string} key localStorage key.
 * @returns {*} Parsed value, or null.
 */
function readStoredJson(key) {
    var raw = localStorage.getItem(key);

    if (raw === null) {
        return null;
    }

    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Convert a value to a finite number.
 *
 * @param {*} value Candidate number.
 * @returns {number|null} Number, or null.
 */
function finiteNumber(value) {
    var numeric = typeof value === 'number' ? value : parseFloat(value);

    return isFinite(numeric) ? numeric : null;
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
    var temperatures = hourly && hourly.temperature_2m;
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
            temp: Array.isArray(temperatures) && typeof temperatures[index] === 'number'
                ? celsiusToFahrenheit(temperatures[index])
                : null,
            precipProbability: typeof precipProbability === 'number'
                ? Math.max(0, Math.min(1, precipProbability / 100))
                : 0,
            uvIndex: typeof uvIndex === 'number' ? uvIndex : UV_UNAVAILABLE
        };
    });

    return byTime;
}

/**
 * Count numeric values in an array.
 *
 * @param {*} values Candidate array.
 * @returns {number} Count of finite numeric values.
 */
function countNumericValues(values) {
    if (!Array.isArray(values)) {
        return 0;
    }

    return values.filter(function(value) {
        return typeof value === 'number' && isFinite(value);
    }).length;
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

/**
 * Return distance between coordinates in km.
 *
 * @param {number} lat1 Latitude 1.
 * @param {number} lon1 Longitude 1.
 * @param {number} lat2 Latitude 2.
 * @param {number} lon2 Longitude 2.
 * @returns {number}
 */
function distanceKm(lat1, lon1, lat2, lon2) {
    var earthRadiusKm = 6371;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad)
        * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusKm * c;
}

/**
 * Check whether a cache belongs to roughly the same point.
 *
 * @param {Object} cache Cached weather data.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {boolean}
 */
function cacheMatchesCoordinates(cache, lat, lon) {
    var cacheLat = cache && cache.coordinates ? finiteNumber(cache.coordinates.lat) : null;
    var cacheLon = cache && cache.coordinates ? finiteNumber(cache.coordinates.lon) : null;

    if (cacheLat === null || cacheLon === null) {
        return false;
    }

    return distanceKm(cacheLat, cacheLon, lat, lon) <= CACHE_COORDINATE_MATCH_KM;
}

/**
 * Return the largest timestamp in hourly entries.
 *
 * @param {{time: number}[]} hourly Hourly entries.
 * @returns {number|null}
 */
function latestHourlyTime(hourly) {
    var latest = null;

    if (!Array.isArray(hourly)) {
        return null;
    }

    hourly.forEach(function(entry) {
        if (entry && typeof entry.time === 'number' && (latest === null || entry.time > latest)) {
            latest = entry.time;
        }
    });

    return latest;
}

/**
 * Determine if hourly data covers the full graph window.
 *
 * @param {{time: number}[]} hourly Hourly entries.
 * @param {number[]} windowTimes Graph timestamps.
 * @returns {boolean}
 */
function coversWindow(hourly, windowTimes) {
    var latest = latestHourlyTime(hourly);

    if (latest === null || windowTimes.length === 0) {
        return false;
    }

    return latest >= windowTimes[windowTimes.length - 1];
}

/**
 * Determine whether cached hourly rows include usable temperatures.
 *
 * @param {Object} cache Cached weather data.
 * @returns {boolean}
 */
function cacheHasTemperature(cache) {
    return Boolean(cache && Array.isArray(cache.hourly) && cache.hourly.some(function(entry) {
        return entry && typeof entry.temp === 'number' && isFinite(entry.temp);
    }));
}

/**
 * Build a trend from a lookup table.
 *
 * @param {Object} byTime Hourly values keyed by Unix timestamp.
 * @param {number[]} windowTimes Graph timestamps.
 * @param {string} field Field to read.
 * @param {*} fallback Fallback value.
 * @returns {Array}
 */
function getTrendFromByTime(byTime, windowTimes, field, fallback) {
    var trend = [];
    var lastValue = fallback;

    windowTimes.forEach(function(windowTime) {
        var entry = byTime[windowTime];
        if (entry && typeof entry[field] === 'number' && isFinite(entry[field])) {
            lastValue = entry[field];
        }
        trend.push(lastValue);
    });

    return trend;
}

/**
 * Create a compact cache for Yandex data.
 *
 * @param {Object} weatherData Parsed Yandex response.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {string} cityName City name.
 * @param {string|null} countryCode Country code.
 * @returns {Object|null}
 */
function buildYandexCache(weatherData, lat, lon, cityName, countryCode) {
    var now = weatherData && weatherData.weatherByPoint && weatherData.weatherByPoint.now;
    var currentTemp;

    if (!now || typeof now.temperature !== 'number') {
        return null;
    }

    currentTemp = celsiusToFahrenheit(now.temperature);
    return {
        version: CACHE_VERSION,
        source: 'yandex',
        fetchedAtUtc: new Date().toISOString(),
        coordinates: {
            lat: lat,
            lon: lon
        },
        cityName: cityName,
        countryCode: countryCode,
        currentTemp: currentTemp,
        hourly: getHourlyForecast(weatherData)
    };
}

/**
 * Create a compact cache for Open-Meteo data.
 *
 * @param {Object} openMeteoData Parsed Open-Meteo response.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {string} cityName City name.
 * @param {string|null} countryCode Country code.
 * @returns {Object}
 */
function buildOpenMeteoCache(openMeteoData, lat, lon, cityName, countryCode) {
    var byTime = getOpenMeteoByTime(openMeteoData);
    var hourly = [];
    var key;

    for (key in byTime) {
        if (Object.prototype.hasOwnProperty.call(byTime, key)) {
            hourly.push({
                time: parseInt(key, 10),
                temp: byTime[key].temp,
                precipProbability: byTime[key].precipProbability,
                uvIndex: byTime[key].uvIndex
            });
        }
    }

    hourly.sort(function(a, b) {
        return a.time - b.time;
    });

    return {
        version: CACHE_VERSION,
        source: 'openmeteo',
        fetchedAtUtc: new Date().toISOString(),
        coordinates: {
            lat: lat,
            lon: lon
        },
        cityName: cityName,
        countryCode: countryCode,
        hourly: hourly
    };
}

/**
 * Write compact weather cache.
 *
 * @param {string} key localStorage key.
 * @param {Object} cache Cache object.
 * @returns {void}
 */
function writeWeatherCache(key, cache) {
    localStorage.setItem(key, JSON.stringify(cache));
}

/**
 * Read compact weather cache.
 *
 * @param {string} key localStorage key.
 * @returns {Object|null}
 */
function readWeatherCache(key) {
    var cache = readStoredJson(key);

    if (!cache || cache.version !== CACHE_VERSION || !Array.isArray(cache.hourly)) {
        return null;
    }

    return cache;
}

/**
 * Build a lookup table from cached hourly rows.
 *
 * @param {Object|null} cache Cached weather data.
 * @returns {Object} Hourly values keyed by Unix timestamp.
 */
function getCacheByTime(cache) {
    var byTime = {};

    if (!cache || !Array.isArray(cache.hourly)) {
        return byTime;
    }

    cache.hourly.forEach(function(entry) {
        if (entry && typeof entry.time === 'number') {
            byTime[entry.time] = entry;
        }
    });

    return byTime;
}

/**
 * Fill provider fields from cached hourly data.
 *
 * @param {YandexProvider} provider Provider instance.
 * @param {Object} primaryCache Cache used for temperature.
 * @param {Object|null} supplementCache Cache used for precipitation/UV.
 * @param {number[]} graphWindowTimes Graph timestamps.
 * @param {string} sourceName Debug source label.
 * @returns {boolean} True when payload fields were populated.
 */
function populateProviderFromCache(provider, primaryCache, supplementCache, graphWindowTimes, sourceName) {
    var primaryByTime = {};
    var supplementByTime = {};
    var fallbackTemp;
    var precipMatched = 0;
    var uvMatched = 0;

    if (!primaryCache || !Array.isArray(primaryCache.hourly) || !coversWindow(primaryCache.hourly, graphWindowTimes)) {
        return false;
    }

    primaryCache.hourly.forEach(function(entry) {
        if (entry && typeof entry.time === 'number') {
            primaryByTime[entry.time] = entry;
        }
    });

    if (supplementCache && Array.isArray(supplementCache.hourly)) {
        supplementCache.hourly.forEach(function(entry) {
            if (entry && typeof entry.time === 'number') {
                supplementByTime[entry.time] = entry;
            }
        });
    }

    fallbackTemp = typeof primaryCache.currentTemp === 'number'
        ? primaryCache.currentTemp
        : getTrendFromByTime(primaryByTime, graphWindowTimes, 'temp', 0)[0];

    provider.startTime = graphWindowTimes[0];
    provider.currentTemp = fallbackTemp;
    provider.tempTrend = getTrendFromByTime(primaryByTime, graphWindowTimes, 'temp', fallbackTemp);
    provider.precipTrend = [];
    provider.uvTrend = [];

    graphWindowTimes.forEach(function(windowTime) {
        var supplement = supplementByTime[windowTime];

        if (supplement && typeof supplement.precipProbability === 'number' && isFinite(supplement.precipProbability)) {
            precipMatched += 1;
            provider.precipTrend.push(supplement.precipProbability);
        }
        else if (primaryByTime[windowTime] && typeof primaryByTime[windowTime].precipProbability === 'number') {
            provider.precipTrend.push(primaryByTime[windowTime].precipProbability);
        }
        else {
            provider.precipTrend.push(0);
        }

        if (supplement && typeof supplement.uvIndex === 'number' && isFinite(supplement.uvIndex)) {
            uvMatched += 1;
            provider.uvTrend.push(supplement.uvIndex);
        }
        else if (primaryByTime[windowTime] && typeof primaryByTime[windowTime].uvIndex === 'number') {
            provider.uvTrend.push(primaryByTime[windowTime].uvIndex);
        }
        else {
            provider.uvTrend.push(UV_UNAVAILABLE);
        }
    });

    provider.cityName = primaryCache.cityName || provider.cityName;
    provider.countryCode = primaryCache.countryCode || provider.countryCode;
    provider.diagnostics.cache = {
        source: sourceName,
        primaryFetchedAtUtc: primaryCache.fetchedAtUtc,
        supplementFetchedAtUtc: supplementCache ? supplementCache.fetchedAtUtc : null,
        graphStart: graphWindowTimes[0],
        graphHours: graphWindowTimes.length,
        precipMatchedHours: precipMatched,
        uvMatchedHours: uvMatched
    };

    return provider.hasValidData();
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
 * Fetch Open-Meteo hourly forecast for the same point.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {boolean} includeTemperature Whether to include temperature data.
 * @param {Function} callback Callback with the parsed response data.
 * @param {Function} onFailure Failure callback.
 * @returns {void}
 */
YandexProvider.prototype.withOpenMeteoResponse = function(lat, lon, includeTemperature, callback, onFailure) {
    var hourlyFields = includeTemperature ? OPEN_METEO_FULL_HOURLY : OPEN_METEO_SUPPLEMENT_HOURLY;
    var url = OPEN_METEO_API_URL
        + '?latitude=' + encodeURIComponent(lat)
        + '&longitude=' + encodeURIComponent(lon)
        + '&hourly=' + hourlyFields
        + '&forecast_days=2'
        + '&timeformat=unixtime'
        + '&timezone=auto';

    console.log('Requesting ' + OPEN_METEO_API_URL + ' for Yandex ' + (includeTemperature ? 'fallback' : 'supplement'));

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

            this.diagnostics.openMeteo = {
                status: 'success',
                includeTemperature: Boolean(includeTemperature),
                hourlyCount: body.hourly.time.length,
                temperatureCount: countNumericValues(body.hourly.temperature_2m),
                precipitationProbabilityCount: countNumericValues(body.hourly.precipitation_probability),
                uvIndexCount: countNumericValues(body.hourly.uv_index)
            };
            callback(body);
        }.bind(this),
        function(error) {
            console.log('[!] Open-Meteo supplement request failed: ' + JSON.stringify(error));
            onFailure({ stage: 'provider_data', code: 'openmeteo_' + error.code });
        }
    );
};

YandexProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    console.log('This is the Yandex Weather implementation of withProviderData');
    var handleYandexFailure;
    lat = finiteNumber(lat);
    lon = finiteNumber(lon);
    if (lat === null || lon === null) {
        onFailure({ stage: 'coordinates', code: 'invalid_coordinates' });
        return;
    }

    handleYandexFailure = (function(yandexFailure) {
        var graphStartTime = roundDownHourUnixSeconds(new Date());
        var graphWindowTimes = buildHourlyWindow(graphStartTime, this.numEntries);
        var cachedOpenMeteo = readWeatherCache(OPEN_METEO_WEATHER_CACHE_KEY);
        var cachedYandex = readWeatherCache(YANDEX_WEATHER_CACHE_KEY);

        this.fetchBackoffFailure = yandexFailure || { stage: 'provider_data', code: 'yandex_unknown_error' };
        this.warnings.push(this.fetchBackoffFailure);
        this.diagnostics.yandex = {
            status: 'failure',
            error: this.fetchBackoffFailure
        };

        this.withOpenMeteoResponse(lat, lon, true, (function(openMeteoData) {
            var openMeteoCache = buildOpenMeteoCache(openMeteoData, lat, lon, this.cityName, this.countryCode);
            writeWeatherCache(OPEN_METEO_WEATHER_CACHE_KEY, openMeteoCache);

            if (populateProviderFromCache(this, openMeteoCache, openMeteoCache, graphWindowTimes, 'openmeteo_fallback')) {
                this.warnings.push({ stage: 'provider_data', code: 'yandex_openmeteo_fallback' });
                onSuccess();
                return;
            }

            onFailure(yandexFailure);
        }).bind(this), (function(openMeteoFailure) {
            var canUseOpenMeteoCache = cachedOpenMeteo && cacheMatchesCoordinates(cachedOpenMeteo, lat, lon);
            var canUseOpenMeteoCacheAsPrimary = canUseOpenMeteoCache && cacheHasTemperature(cachedOpenMeteo);
            var canUseYandexCache = cachedYandex && cacheMatchesCoordinates(cachedYandex, lat, lon);

            this.diagnostics.openMeteo = {
                status: 'failure',
                includeTemperature: true,
                error: openMeteoFailure || { stage: 'provider_data', code: 'openmeteo_unknown_error' }
            };

            if (canUseOpenMeteoCacheAsPrimary
                && populateProviderFromCache(this, cachedOpenMeteo, cachedOpenMeteo, graphWindowTimes, 'openmeteo_cache')) {
                this.warnings.push({ stage: 'provider_data', code: 'openmeteo_cached_fallback' });
                onSuccess();
                return;
            }

            if (canUseYandexCache && canUseOpenMeteoCache
                && populateProviderFromCache(this, cachedYandex, cachedOpenMeteo, graphWindowTimes, 'yandex_cache_openmeteo_cache')) {
                this.warnings.push({ stage: 'provider_data', code: 'mixed_cached_fallback' });
                onSuccess();
                return;
            }

            if (canUseYandexCache
                && populateProviderFromCache(this, cachedYandex, null, graphWindowTimes, 'yandex_cache')) {
                this.warnings.push({ stage: 'provider_data', code: 'yandex_cached_fallback' });
                onSuccess();
                return;
            }

            onFailure(yandexFailure || openMeteoFailure);
        }).bind(this));
    }).bind(this);

    if (this.skipPrimaryFetch) {
        handleYandexFailure({
            stage: 'provider_data',
            code: this.skipPrimaryFetchReason || 'yandex_backoff'
        });
        return;
    }

    this.withYandexResponse(lat, lon, (function(weatherData) {
        var now = weatherData.weatherByPoint.now;
        var currentTemp;
        var hourly;
        var graphStartTime;
        var graphWindowTimes;
        var finishWithSupplement;
        var yandexCache;

        if (typeof now.temperature !== 'number') {
            onFailure({ stage: 'provider_data', code: 'yandex_current_temp_missing' });
            return;
        }

        currentTemp = celsiusToFahrenheit(now.temperature);
        hourly = getHourlyForecast(weatherData);
        graphStartTime = roundDownHourUnixSeconds(new Date());
        graphWindowTimes = buildHourlyWindow(graphStartTime, this.numEntries);
        yandexCache = buildYandexCache(weatherData, lat, lon, this.cityName, this.countryCode);
        if (yandexCache) {
            writeWeatherCache(YANDEX_WEATHER_CACHE_KEY, yandexCache);
        }

        this.startTime = graphStartTime;
        this.tempTrend = getTempTrendForWindow(hourly, graphWindowTimes, currentTemp);
        this.currentTemp = currentTemp;

        finishWithSupplement = (function(openMeteoData) {
            var openMeteoCache = openMeteoData
                ? buildOpenMeteoCache(openMeteoData, lat, lon, this.cityName, this.countryCode)
                : null;
            var openMeteoByTime = openMeteoData ? getOpenMeteoByTime(openMeteoData) : {};
            var index;
            var supplement;
            var matchedHours = 0;
            var matchedPrecipHours = 0;
            var matchedUvHours = 0;

            if (openMeteoCache) {
                writeWeatherCache(OPEN_METEO_WEATHER_CACHE_KEY, openMeteoCache);
            }
            else {
                openMeteoCache = readWeatherCache(OPEN_METEO_WEATHER_CACHE_KEY);
                if (openMeteoCache
                    && cacheMatchesCoordinates(openMeteoCache, lat, lon)
                    && coversWindow(openMeteoCache.hourly, graphWindowTimes)) {
                    openMeteoByTime = getCacheByTime(openMeteoCache);
                    if (!this.diagnostics.openMeteo) {
                        this.diagnostics.openMeteo = {};
                    }
                    this.diagnostics.openMeteo.status = this.diagnostics.openMeteo.status || 'cached';
                    this.diagnostics.openMeteo.cachedSupplement = true;
                }
                else {
                    openMeteoCache = null;
                }
            }

            this.precipTrend = [];
            this.uvTrend = [];
            for (index = 0; index < this.numEntries; index += 1) {
                supplement = openMeteoByTime[graphWindowTimes[index]];
                if (supplement) {
                    matchedHours += 1;
                    if (typeof supplement.precipProbability === 'number' && isFinite(supplement.precipProbability)) {
                        matchedPrecipHours += 1;
                    }
                    if (typeof supplement.uvIndex === 'number' && isFinite(supplement.uvIndex)) {
                        matchedUvHours += 1;
                    }
                }

                this.precipTrend.push(supplement ? supplement.precipProbability : 0);
                this.uvTrend.push(supplement ? supplement.uvIndex : UV_UNAVAILABLE);
            }

            if (!this.diagnostics.openMeteo) {
                this.diagnostics.openMeteo = {
                    status: openMeteoData ? 'success' : 'unavailable'
                };
            }
            this.diagnostics.openMeteo.matchedGraphHours = matchedHours;
            this.diagnostics.openMeteo.matchedPrecipitationHours = matchedPrecipHours;
            this.diagnostics.openMeteo.matchedUvHours = matchedUvHours;
            this.diagnostics.cache = {
                source: openMeteoCache ? 'yandex_openmeteo' : 'yandex_only',
                yandexCachedHours: yandexCache && yandexCache.hourly ? yandexCache.hourly.length : 0,
                openMeteoCachedHours: openMeteoCache && openMeteoCache.hourly ? openMeteoCache.hourly.length : 0,
                yandexFetchedAtUtc: yandexCache ? yandexCache.fetchedAtUtc : null,
                openMeteoFetchedAtUtc: openMeteoCache ? openMeteoCache.fetchedAtUtc : null,
                graphStart: graphStartTime,
                graphHours: graphWindowTimes.length
            };

            onSuccess();
        }).bind(this);

        this.withOpenMeteoResponse(lat, lon, false, finishWithSupplement, (function(error) {
            console.log('Open-Meteo supplement unavailable: ' + JSON.stringify(error));
            this.diagnostics.openMeteo = {
                status: 'failure',
                error: error || { stage: 'provider_data', code: 'openmeteo_unknown_error' }
            };
            this.warnings.push(error || { stage: 'provider_data', code: 'openmeteo_unknown_error' });
            finishWithSupplement(null);
        }).bind(this));
    }).bind(this), handleYandexFailure);
};

module.exports = YandexProvider;
