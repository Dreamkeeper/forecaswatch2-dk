var meta = require('../../../package.json');
var profileLabel = meta.buildProfile === "release" ? "" : " (" + meta.buildProfile + ")";
var versionLabel = "v" + meta.version + profileLabel;

var config = [
    {
        "type": "heading",
        "defaultValue": "YaForecasWatch2"
    },
    {
        "type": "text",
        "defaultValue": "Contribute on <a href=\"https://github.com/Dreamkeeper/YaForecasWatch2\">GitHub!</a>"
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Time",
            },
            {
                "type": "toggle",
                "label": "Leading zero",
                "messageKey": "timeLeadingZero",
            },
            {
                "type": "toggle",
                "label": "Show AM/PM",
                "messageKey": "timeShowAmPm",
            },
            {
                "type": "select",
                "label": "Axis time format",
                "messageKey": "axisTimeFormat",
                "defaultValue": "24h",
                "description": "Tip: go to Settings > Date & Time > Time Format on your watch to change the main time format",
                "options": [
                    {
                        "label": "12h",
                        "value": "12h"
                    },
                    {
                        "label": "24h",
                        "value": "24h"
                    }
                ]
            },
            {
                "type": "select",
                "label": "Main time font",
                "messageKey": "timeFont",
                "defaultValue": "roboto",
                "options": [
                    {
                        "label": "Roboto",
                        "value": "roboto"
                    },
                    {
                        "label": "Leco",
                        "value": "leco"
                    },
                    {
                        "label": "Bitham",
                        "value": "bitham"
                    },
                ]
            },
            {
                "type": "color",
                "label": "Main time color",
                "messageKey": "colorTime",
                "defaultValue": "#FFFFFF",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Calendar",
            },
            {
                "type": "select",
                "label": "Start week on",
                "messageKey": "weekStartDay",
                "defaultValue": "sun",
                "options": [
                    {
                        "label": "Sunday",
                        "value": "sun"
                    },
                    {
                        "label": "Monday",
                        "value": "mon"
                    }
                ]
            },
            {
                "type": "select",
                "label": "First week to display",
                "messageKey": "firstWeek",
                "defaultValue": "prev",
                "options": [
                    {
                        "label": "Previous week",
                        "value": "prev"
                    },
                    {
                        "label": "Current week",
                        "value": "curr"
                    }
                ]
            },
            {
                "type": "color",
                "label": "Today highlight",
                "messageKey": "colorToday",
                "defaultValue": "#000000",
                "description": "Black (default) means match date color, any other value overrides this.",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "color",
                "label": "Sunday color",
                "messageKey": "colorSunday",
                "defaultValue": "#FF0055",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "color",
                "label": "Saturday color",
                "messageKey": "colorSaturday",
                "defaultValue": "#FF0055",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "color",
                "label": "Holiday set 1 color",
                "messageKey": "colorHoliday1",
                "defaultValue": "#FF0055",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "select",
                "label": "Holiday set 1",
                "messageKey": "holidaySet1",
                "defaultValue": "1",
                "options": [
                    {
                        "label": "None",
                        "value": "0"
                    },
                    {
                        "label": "US",
                        "value": "1"
                    },
                    {
                        "label": "Russia",
                        "value": "2"
                    },
                    {
                        "label": "Spain national",
                        "value": "3"
                    },
                    {
                        "label": "Spain + Catalonia",
                        "value": "4"
                    }
                ]
            },
            {
                "type": "color",
                "label": "Holiday set 2 color",
                "messageKey": "colorHoliday2",
                "defaultValue": "#00AAFF",
                "sunlight": false,
                "capabilities": ["COLOR"]
            },
            {
                "type": "select",
                "label": "Holiday set 2",
                "messageKey": "holidaySet2",
                "defaultValue": "0",
                "options": [
                    {
                        "label": "None",
                        "value": "0"
                    },
                    {
                        "label": "US",
                        "value": "1"
                    },
                    {
                        "label": "Russia",
                        "value": "2"
                    },
                    {
                        "label": "Spain national",
                        "value": "3"
                    },
                    {
                        "label": "Spain + Catalonia",
                        "value": "4"
                    }
                ]
            },
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Weather"
            },
            {
                "type": "select",
                "defaultValue": "f",
                "messageKey": "temperatureUnits",
                "label": "Temperature Units",
                "options": [
                    {
                        "label": "°F",
                        "value": "f"
                    },
                    {
                        "label": "°C",
                        "value": "c"
                    }
                ]
            },
            {
                "type": "toggle",
                "label": "Day/night shading",
                "messageKey": "dayNightShading",
                "defaultValue": true,
                "description": "Show hatch shading between sunset and sunrise to distinguish day and night on the forecast graph."
            },
            {
                "type": "radiogroup",
                "label": "Provider",
                "messageKey": "provider",
                "defaultValue": "wunderground",
                "options": [
                    {
                        "label": "Weather Underground",
                        "value": "wunderground"
                    },
                    {
                        "label": "OpenWeatherMap",
                        "value": "openweathermap"
                    },
                    {
                        "label": "Yandex Weather",
                        "value": "yandex"
                    }
                ]
            },
            {
                "type": "input",
                "label": "OpenWeatherMap API key",
                "messageKey": "owmApiKey",
                "description": "<a href='https://openweathermap.org/'>Register an OpenWeatherMap account</a> and paste your API key here"
            },
            {
                "type": "input",
                "label": "Yandex Weather API key",
                "messageKey": "yandexApiKey",
                "description": "<a href='https://yandex.ru/pogoda/b2b/smarthome'>Get a Yandex Weather API key</a> and paste it here"
            },
            {
                "type": "toggle",
                "label": "Force weather fetch",
                "messageKey": "fetch",
                "description": "Last successful fetch:<br><span id='lastFetchSpan'>Never :(</span><span id='lastAttemptBlock'></span>"
            },
            {
                "type": "input",
                "label": "Location override",
                "messageKey": "location",
                "description": "Example: \"Manhattan\" or \"123 Oak St Plainsville KY\".<br><a href=\"https://locationiq.com/demo\">Click here</a> to test out your location query.<br>To use GPS, leave this blank and ensure GPS is enabled on your device.",
                "attributes": {
                    "placeholder": "Using GPS",
                }
            }
        ]
    },
    {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Misc"
            },
            {
                "type": "toggle",
                "label": "Show quiet time icon",
                "messageKey": "showQt",
                "defaultValue": true
            },
            {
                "type": "toggle",
                "label": "Vibrate on bluetooth disconnect",
                "messageKey": "vibe",
                "defaultValue": false
            },
            {
                "type": "select",
                "defaultValue": "both",
                "messageKey": "btIcons",
                "label": "Show icon for bluetooth",
                "options": [
                    {
                        "label": "Disconnected",
                        "value": "disconnected"
                    },
                    {
                        "label": "Connected",
                        "value": "connected"
                    },
                    {
                        "label": "Both",
                        "value": "both"
                    },
                    {
                        "label": "None",
                        "value": "none"
                    }
                ]
            },
        ]
    },
    {
        "type": "submit",
        "defaultValue": "Save Settings"
    },
    {
        "type": "text",
        "defaultValue": versionLabel
    }
];

if (meta.buildProfile === "debug") {
    config.splice(config.length - 2, 0, {
        "type": "section",
        "items": [
            {
                "type": "heading",
                "defaultValue": "Debug"
            },
            {
                "type": "text",
                "defaultValue": "<textarea id='debugWeatherLog' readonly style='box-sizing:border-box;width:100%;min-height:180px;background:#202124;color:#f1f3f4;border:1px solid #5f6368;border-radius:4px;padding:8px;font-family:monospace;font-size:12px;line-height:1.35;white-space:pre-wrap;'>No debug log yet.</textarea>"
            }
        ]
    });
}

module.exports = config;
