var WeatherProvider = require('./weather/provider.js');

var CACHE_VERSION = 'v1';
var CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
var BITSET_BYTES = 46;
var NAGER_BASE_URL = 'https://date.nager.at/api/v3/PublicHolidays/';

var HOLIDAY_SET_NONE = 0;
var HOLIDAY_SET_US = 1;
var HOLIDAY_SET_RU = 2;
var HOLIDAY_SET_ES_NATIONAL = 3;
var HOLIDAY_SET_ES_CATALONIA = 4;

var HOLIDAY_SOURCES = {};
HOLIDAY_SOURCES[HOLIDAY_SET_US] = { countryCode: 'US', scope: 'national' };
HOLIDAY_SOURCES[HOLIDAY_SET_RU] = { countryCode: 'RU', scope: 'national' };
HOLIDAY_SOURCES[HOLIDAY_SET_ES_NATIONAL] = { countryCode: 'ES', scope: 'national' };
HOLIDAY_SOURCES[HOLIDAY_SET_ES_CATALONIA] = { countryCode: 'ES', scope: 'catalonia' };

var rawCountryYearCache = {};

/**
 * Return whether a Nager.Date holiday has a bank/public type.
 *
 * @param {Object} holiday Nager.Date holiday.
 * @returns {boolean} True for public/bank holidays.
 */
function hasPublicOrBankType(holiday) {
    var types = holiday && holiday.types;

    return Array.isArray(types) && (types.indexOf('Public') !== -1 || types.indexOf('Bank') !== -1);
}

/**
 * Return whether a Nager.Date holiday applies to the given holiday set.
 *
 * @param {Object} holiday Nager.Date holiday.
 * @param {number} holidaySet Holiday set id.
 * @returns {boolean} True when the holiday should be included.
 */
function holidayMatchesSet(holiday, holidaySet) {
    var counties = holiday && holiday.counties;

    if (!holiday || !hasPublicOrBankType(holiday)) {
        return false;
    }

    if (holidaySet === HOLIDAY_SET_ES_CATALONIA) {
        return holiday.global === true || (Array.isArray(counties) && counties.indexOf('ES-CT') !== -1);
    }

    return holiday.global === true;
}

/**
 * Return sorted unique YYYY-MM-DD dates for a holiday set.
 *
 * @param {Object[]} holidays Raw Nager.Date holidays.
 * @param {number} holidaySet Holiday set id.
 * @returns {string[]} Filtered holiday dates.
 */
function filterHolidayDates(holidays, holidaySet) {
    var seen = {};
    var out = [];

    if (!Array.isArray(holidays)) {
        return out;
    }

    holidays.forEach(function(holiday) {
        if (
            holidayMatchesSet(holiday, holidaySet) &&
            typeof holiday.date === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(holiday.date) &&
            !seen[holiday.date]
        ) {
            seen[holiday.date] = true;
            out.push(holiday.date);
        }
    });

    out.sort();
    return out;
}

/**
 * Build the localStorage cache key for one source/year.
 *
 * @param {string} countryCode ISO country code.
 * @param {string} scope Holiday scope.
 * @param {number} year Calendar year.
 * @returns {string} Cache key.
 */
function cacheKey(countryCode, scope, year) {
    return 'holiday-cache:' + CACHE_VERSION + ':' + countryCode + ':' + scope + ':' + year;
}

/**
 * Safely parse a cached holiday entry.
 *
 * @param {string} key localStorage key.
 * @returns {Object|null} Cached value.
 */
function readCache(key) {
    var parsed;

    try {
        parsed = JSON.parse(localStorage.getItem(key));
    }
    catch (ex) {
        return null;
    }

    if (!parsed || !Array.isArray(parsed.dates) || typeof parsed.fetchedAtUtc !== 'string') {
        return null;
    }

    return parsed;
}

/**
 * Determine whether cached holidays are older than the refresh interval.
 *
 * @param {Object} cached Cached entry.
 * @param {number} nowMs Current time in milliseconds.
 * @returns {boolean} True when refresh should be attempted.
 */
function isStale(cached, nowMs) {
    var fetchedMs = Date.parse(cached.fetchedAtUtc);

    return !isFinite(fetchedMs) || nowMs - fetchedMs > CACHE_TTL_MS;
}

/**
 * Fetch one raw country/year response from Nager.Date.
 *
 * @param {string} countryCode ISO country code.
 * @param {number} year Calendar year.
 * @param {Function} onSuccess Success callback.
 * @param {Function} onFailure Failure callback.
 * @returns {void}
 */
function fetchRawCountryYear(countryCode, year, onSuccess, onFailure) {
    var rawKey = countryCode + ':' + year;

    if (Object.prototype.hasOwnProperty.call(rawCountryYearCache, rawKey)) {
        onSuccess(rawCountryYearCache[rawKey]);
        return;
    }

    WeatherProvider.request(NAGER_BASE_URL + year + '/' + countryCode, 'GET', function(responseText) {
        try {
            rawCountryYearCache[rawKey] = JSON.parse(responseText);
            onSuccess(rawCountryYearCache[rawKey]);
        }
        catch (ex) {
            onFailure({ code: 'invalid_json', detail: ex.message });
        }
    }, onFailure);
}

/**
 * Write filtered dates to localStorage.
 *
 * @param {string} key Cache key.
 * @param {Object} source Holiday source.
 * @param {number} year Calendar year.
 * @param {string[]} dates Filtered holiday dates.
 * @returns {Object} Cached entry.
 */
function writeCache(key, source, year, dates) {
    var cached = {
        fetchedAtUtc: new Date().toISOString(),
        source: source.countryCode + ':' + source.scope + ':' + year,
        dates: dates
    };

    localStorage.setItem(key, JSON.stringify(cached));
    return cached;
}

/**
 * Load one holiday set/year, using cached dates immediately when available.
 *
 * @param {number} holidaySet Holiday set id.
 * @param {number} year Calendar year.
 * @param {Function} onReady Callback with dates and metadata.
 * @returns {void}
 */
function loadHolidaySetYear(holidaySet, year, onReady) {
    var source = HOLIDAY_SOURCES[holidaySet];
    var key;
    var cached;
    var nowMs = Date.now();

    if (!source) {
        onReady([], { status: 'disabled' });
        return;
    }

    key = cacheKey(source.countryCode, source.scope, year);
    cached = readCache(key);

    function refresh() {
        fetchRawCountryYear(source.countryCode, year, function(raw) {
            var dates = filterHolidayDates(raw, holidaySet);
            var fresh = writeCache(key, source, year, dates);
            console.log('[holidays] refreshed ' + fresh.source + ' dates=' + dates.length);
            onReady(dates, { status: 'fresh', source: fresh.source });
        }, function(error) {
            console.log('[holidays] refresh failed for ' + key + ': ' + JSON.stringify(error));
            if (!cached) {
                onReady([], { status: 'failed_empty', error: error });
            }
        });
    }

    if (cached) {
        onReady(cached.dates, {
            status: isStale(cached, nowMs) ? 'stale' : 'cached',
            source: cached.source
        });
        if (isStale(cached, nowMs)) {
            refresh();
        }
        return;
    }

    refresh();
}

/**
 * Convert YYYY-MM-DD strings into a 366-bit packed calendar.
 *
 * @param {number} year Calendar year.
 * @param {string[]} dates Holiday dates.
 * @returns {number[]} Packed bitset bytes.
 */
function packHolidayBits(year, dates) {
    var bytes = [];
    var i;

    for (i = 0; i < BITSET_BYTES; i += 1) {
        bytes.push(0);
    }

    dates.forEach(function(dateString) {
        var date;
        var start;
        var day;

        if (dateString.indexOf(year + '-') !== 0) {
            return;
        }

        date = new Date(dateString + 'T00:00:00Z');
        start = new Date(year + '-01-01T00:00:00Z');
        day = Math.floor((date.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
        if (day >= 0 && day < 366) {
            bytes[Math.floor(day / 8)] |= (1 << (day % 8));
        }
    });

    return bytes;
}

/**
 * Return previous/current/next years for holiday rendering.
 *
 * @param {Date=} now Current date.
 * @returns {number[]} Years to load.
 */
function getHolidayYears(now) {
    var year = (now || new Date()).getFullYear();
    return [year - 1, year, year + 1];
}

/**
 * Normalize a Clay holiday set value.
 *
 * @param {*} value Candidate set id.
 * @returns {number} Holiday set id.
 */
function normalizeHolidaySet(value) {
    var parsed = typeof value === 'number' ? value : parseInt(value, 10);

    if (Object.prototype.hasOwnProperty.call(HOLIDAY_SOURCES, parsed)) {
        return parsed;
    }

    return HOLIDAY_SET_NONE;
}

/**
 * Send holiday bitsets for current settings to the watch.
 *
 * @param {Object} settings Clay settings.
 * @param {Function=} onDone Optional completion callback.
 * @returns {void}
 */
function sendHolidayBitsets(settings, onDone) {
    var years = getHolidayYears();
    var jobs = [];
    var slots = [
        { slot: 1, holidaySet: normalizeHolidaySet(settings.holidaySet1) },
        { slot: 2, holidaySet: normalizeHolidaySet(settings.holidaySet2) }
    ];

    slots.forEach(function(slotInfo) {
        years.forEach(function(year) {
            jobs.push({
                slot: slotInfo.slot,
                holidaySet: slotInfo.holidaySet,
                year: year
            });
        });
    });

    function next() {
        var job = jobs.shift();

        if (!job) {
            if (typeof onDone === 'function') {
                onDone();
            }
            return;
        }

        loadHolidaySetYear(job.holidaySet, job.year, function(dates, meta) {
            var payload = {
                HOLIDAY_SLOT: job.slot,
                HOLIDAY_SET: job.holidaySet,
                HOLIDAY_YEAR: job.year,
                HOLIDAY_BITS: packHolidayBits(job.year, dates)
            };

            Pebble.sendAppMessage(payload, function() {
                console.log('[holidays] sent ' + JSON.stringify({
                    slot: job.slot,
                    holidaySet: job.holidaySet,
                    year: job.year,
                    dates: dates.length,
                    status: meta.status
                }));
                next();
            }, function(error) {
                console.log('[holidays] send failed: ' + JSON.stringify(error));
                next();
            });
        });
    }

    next();
}

module.exports = {
    HOLIDAY_SET_NONE: HOLIDAY_SET_NONE,
    HOLIDAY_SET_US: HOLIDAY_SET_US,
    HOLIDAY_SET_RU: HOLIDAY_SET_RU,
    HOLIDAY_SET_ES_NATIONAL: HOLIDAY_SET_ES_NATIONAL,
    HOLIDAY_SET_ES_CATALONIA: HOLIDAY_SET_ES_CATALONIA,
    filterHolidayDates: filterHolidayDates,
    packHolidayBits: packHolidayBits,
    sendHolidayBitsets: sendHolidayBitsets,
    normalizeHolidaySet: normalizeHolidaySet,
    _cacheKey: cacheKey,
    _isStale: isStale
};
