#pragma once

#include <pebble.h>

#include "config.h"

#define HOLIDAY_BITSET_BYTES 46

typedef struct {
    int16_t year;
    uint8_t holiday_set;
    uint8_t bits[HOLIDAY_BITSET_BYTES];
} HolidayYear;

void persist_init();

bool persist_has_forecast_data();

int persist_get_temp_lo();

int persist_get_temp_hi();

int persist_get_temp_trend(int16_t *buffer, const size_t buffer_size);

int persist_get_precip_trend(uint8_t *buffer, const size_t buffer_size);

int persist_get_uv_trend(uint8_t *buffer, const size_t buffer_size);

time_t persist_get_forecast_start();

int persist_get_num_entries();

int persist_get_current_temp();

int persist_get_city(char *buffer, const size_t buffer_size);

int persist_get_sun_event_start_type();

int persist_get_sun_event_times(time_t *buffer, const size_t buffer_size);

int persist_get_config(Config *config);

bool persist_get_debug_fetch_error();

bool persist_get_holiday_year(uint8_t slot, int16_t year, HolidayYear *holiday_year);

void persist_set_temp_lo(int val);

void persist_set_temp_hi(int val);

void persist_set_temp_trend(int16_t *data, const size_t size);

void persist_set_precip_trend(uint8_t *data, const size_t size);

void persist_set_uv_trend(uint8_t *data, const size_t size);

void persist_set_forecast_start(time_t val);

void persist_set_num_entries(int val);

void persist_set_current_temp(int val);

void persist_set_city(char *val);

void persist_set_sun_event_start_type(int val);

void persist_set_sun_event_times(time_t *data, const size_t size);

void persist_set_config(Config config);

void persist_set_debug_fetch_error(bool val);

void persist_set_holiday_year(uint8_t slot, const HolidayYear *holiday_year);
