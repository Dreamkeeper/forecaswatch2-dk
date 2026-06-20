# Store Submission Notes

Use the production `.pbw` for app-store submission. Keep the debug build on GitHub Releases only, because it exposes extra local diagnostic UI intended for troubleshooting.

## Candidate

- App name: YaForecasWatch2
- Source Code URL: https://github.com/Dreamkeeper/YaForecasWatch2
- Website URL: https://github.com/Dreamkeeper/YaForecasWatch2
- License: GPL-3.0
- PBW: `YaForecasWatch2-v1.34.2.pbw`

## Short Description

YaForecasWatch2 is a ForecasWatch2 fork with Yandex Weather, Open-Meteo UV and rain supplements, Russian/Spanish/US holiday highlights, and no telemetry.

## Longer Description

YaForecasWatch2 keeps the compact calendar and forecast layout of ForecasWatch2 while adding better support for users outside the original Weather Underground/OpenWeatherMap flow.

New in this fork:

- Yandex Weather provider support.
- Open-Meteo supplements for UV index and precipitation probability when Yandex Weather is selected.
- Up to two configurable holiday sets, including US, Russia, Spain national holidays, and Spain plus Catalonia.
- Nager.Date holiday syncing with local caching so holiday highlights continue to work offline.
- Pebble Time 2 support inherited from the upstream watchface.
- No telemetry in production or debug builds.

## Release Notes

Initial YaForecasWatch2 store release. Adds Yandex Weather support, Open-Meteo UV/rain supplements, configurable Nager.Date holiday highlights, updated screenshots, a unique app UUID/display name, and disables telemetry.

## Screenshots

Recommended screenshots are in `screenshot/yaforecaswatch2-moscow/composite/`:

- `pebble-time-red.png`
- `pebble2-duo-white.png`
- `pebble-time2-red.png`
