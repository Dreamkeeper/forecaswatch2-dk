#pragma once

#include <pebble.h>

void loading_layer_create(Layer* parent_layer, GRect frame);

bool loading_layer_has_cached_data();

bool loading_layer_needs_refresh();

void loading_layer_refresh();

void loading_layer_destroy();
