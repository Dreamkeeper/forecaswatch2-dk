#include "calendar_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/persist.h"
#include "c/services/watch_services.h"
#include <time.h>

#define NUM_WEEKS 3
#define DAYS_PER_WEEK 7
#define FONT_OFFSET 5
#define EMERY_CALENDAR_TEXT_SHIFT_Y 5
#define EMERY_CALENDAR_TEXT_SHIFT_X 1

// emery: render calendar dates with larger fonts
#ifdef PBL_PLATFORM_EMERY
#define CALENDAR_FONT_KEY FONT_KEY_GOTHIC_24
#define CALENDAR_FONT_KEY_BOLD FONT_KEY_GOTHIC_24_BOLD
#else
#define CALENDAR_FONT_KEY FONT_KEY_GOTHIC_18
#define CALENDAR_FONT_KEY_BOLD FONT_KEY_GOTHIC_18_BOLD
#endif

static Layer *s_calendar_layer;

typedef struct {
    bool slot_1;
    bool slot_2;
} HolidayMatch;

static GRect calendar_cell_rect(GRect bounds, int i) {
    const int box_w = bounds.size.w / DAYS_PER_WEEK;
    const int box_h = bounds.size.h / NUM_WEEKS;
    return GRect((i % DAYS_PER_WEEK) * bounds.size.w / DAYS_PER_WEEK,
                 (i / DAYS_PER_WEEK) * bounds.size.h / NUM_WEEKS,
                 box_w, box_h);
}

#ifdef PBL_PLATFORM_EMERY
// Apply a tiny Emery-only horizontal tweak for two-digit dates that start with "1"
// to ensure they stay visually centered within calendar boxes.
static int emery_calendar_text_shift_x(const char *text) {
    if (text[1] != '\0' && text[0] == '1') {
        return EMERY_CALENDAR_TEXT_SHIFT_X;
    }

    return 0;
}
#endif

#ifdef PBL_PLATFORM_EMERY
static GRect calendar_text_rect(GRect cell_rect, const char *text, GFont font) {
    // emery: measure real glyph bounds and vertically center text in each date cell.
    const GRect measure_box = GRect(0, 0, cell_rect.size.w, cell_rect.size.h);
    const GSize text_size = graphics_text_layout_get_content_size(
        text, font, measure_box, GTextOverflowModeFill, GTextAlignmentCenter);
    const int text_top = cell_rect.origin.y + (cell_rect.size.h - text_size.h) / 2 - EMERY_CALENDAR_TEXT_SHIFT_Y;
    return GRect(cell_rect.origin.x - emery_calendar_text_shift_x(text), text_top, cell_rect.size.w, text_size.h);
}
#else
static GRect calendar_text_rect(GRect cell_rect, const char *text, GFont font) {
    (void)text;
    (void)font;
    return GRect(cell_rect.origin.x,
                 cell_rect.origin.y - FONT_OFFSET,
                 cell_rect.size.w,
                 cell_rect.size.h + FONT_OFFSET);
}
#endif

/* Copy struct tm out of localtime's static buffer — see localtime(3). */
static struct tm relative_tm(int days_from_today)
{
    /* Get a time structure for n days from today (only accurate to the day)
    Use this function to avoid edge cases from daylight savings time
    */
    struct tm base_time = watch_services_localtime();
    // Set arbitrary hour so there's no daylight savings rounding error:
    base_time.tm_hour = 5;
    time_t timestamp = mktime(&base_time) + days_from_today * SECONDS_PER_DAY;
    struct tm *result = localtime(&timestamp);
    struct tm out = *result;
    return out;
}

static bool is_leap_year(int year) {
    return ((year % 4 == 0) && (year % 100 != 0)) || (year % 400 == 0);
}

static int day_of_year(struct tm *t) {
    static const uint16_t month_offsets[] = {
        0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334
    };
    int year = t->tm_year + 1900;
    int day = month_offsets[t->tm_mon] + t->tm_mday - 1;

    if (t->tm_mon > 1 && is_leap_year(year)) {
        day += 1;
    }

    return day;
}

static bool holiday_year_has_day(uint8_t slot, uint8_t holiday_set, struct tm *t) {
    HolidayYear holiday_year;
    int bit_index;

    if (holiday_set == HOLIDAY_SET_NONE) {
        return false;
    }

    if (!persist_get_holiday_year(slot, (int16_t)(t->tm_year + 1900), &holiday_year)) {
        return false;
    }

    if (holiday_year.holiday_set != holiday_set) {
        return false;
    }

    bit_index = day_of_year(t);
    if (bit_index < 0 || bit_index >= 366) {
        return false;
    }

    return (holiday_year.bits[bit_index / 8] & (1 << (bit_index % 8))) != 0;
}

static HolidayMatch holiday_match(struct tm *t) {
    HolidayMatch match = (HolidayMatch) {
        .slot_1 = holiday_year_has_day(1, g_config->holiday_set_1, t),
        .slot_2 = holiday_year_has_day(2, g_config->holiday_set_2, t)
    };

    if (g_config->holiday_set_1 == g_config->holiday_set_2) {
        match.slot_2 = false;
    }

    return match;
}

static bool is_configured_holiday(struct tm *t) {
    HolidayMatch match = holiday_match(t);
    return match.slot_1 || match.slot_2;
}

static GColor holiday_color(HolidayMatch match) {
    if (match.slot_1) {
        return g_config->color_holiday_1;
    }
    if (match.slot_2) {
        return g_config->color_holiday_2;
    }
    return GColorWhite;
}

#ifdef PBL_COLOR
static GRect holiday_highlight_rect(GRect cell_rect) {
#ifdef PBL_PLATFORM_EMERY
    // emery: keep the chip large enough for the larger calendar font.
    return GRect(cell_rect.origin.x + 1, cell_rect.origin.y + 2, cell_rect.size.w - 2, cell_rect.size.h - 4);
#else
    return GRect(cell_rect.origin.x + 2, cell_rect.origin.y + 1, cell_rect.size.w - 4, cell_rect.size.h - 2);
#endif
}

static void fill_split_rect(GContext *ctx, GRect rect, GColor left_color, GColor right_color) {
    int left_w = rect.size.w / 2;

    graphics_context_set_fill_color(ctx, left_color);
    graphics_fill_rect(ctx, GRect(rect.origin.x, rect.origin.y, left_w, rect.size.h), 1, GCornersLeft);
    graphics_context_set_fill_color(ctx, right_color);
    graphics_fill_rect(ctx, GRect(rect.origin.x + left_w, rect.origin.y, rect.size.w - left_w, rect.size.h), 1, GCornersRight);
}

static void draw_holiday_highlight(GContext *ctx, GRect rect, HolidayMatch match) {
    if (match.slot_1 && match.slot_2) {
        fill_split_rect(ctx, rect, g_config->color_holiday_1, g_config->color_holiday_2);
        return;
    }

    graphics_context_set_fill_color(ctx, holiday_color(match));
    graphics_fill_rect(ctx, rect, 1, GCornersAll);
}
#endif

#ifdef PBL_COLOR
static GColor date_color(struct tm *t) {
    // Get color for a date, considering weekends and holidays
    if (t->tm_wday == 0)
        return g_config->color_sunday;
    if (t->tm_wday == 6)
        return g_config->color_saturday;
    return GColorWhite;
}
#endif

static GColor today_color() {
    // Either follow the date color or override to configured value
#ifdef PBL_COLOR
    struct tm t = relative_tm(0);
    HolidayMatch match = holiday_match(&t);
    return gcolor_equal(g_config->color_today, GColorBlack) && (match.slot_1 || match.slot_2)
        ? holiday_color(match)
        : (gcolor_equal(g_config->color_today, GColorBlack) ? date_color(&t) : g_config->color_today);
#else
    return GColorWhite;
#endif
}

static void calendar_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int w = bounds.size.w;
    int h = bounds.size.h;
    const int box_w = w / DAYS_PER_WEEK;
    const int box_h = h / NUM_WEEKS;

    // Calculate which box holds today's date
    const int i_today = config_n_today();

    GRect today_rect = GRect((i_today % DAYS_PER_WEEK) * w / DAYS_PER_WEEK, (i_today / DAYS_PER_WEEK) * h / NUM_WEEKS,
        box_w, box_h);

#ifdef PBL_COLOR
    struct tm tm_today = relative_tm(0);
    HolidayMatch today_holiday = holiday_match(&tm_today);

    if (gcolor_equal(g_config->color_today, GColorBlack) && today_holiday.slot_1 && today_holiday.slot_2) {
        fill_split_rect(ctx, today_rect, g_config->color_holiday_1, g_config->color_holiday_2);
    }
    else {
        graphics_context_set_fill_color(ctx, today_color());
        graphics_fill_rect(ctx, today_rect, 1, GCornersAll);
    }
#else
    graphics_context_set_fill_color(ctx, today_color());
    graphics_fill_rect(ctx, today_rect, 1, GCornersAll);
#endif

    for (int i = 0; i < NUM_WEEKS * DAYS_PER_WEEK; ++i) {
        struct tm t = relative_tm(i - i_today);
        HolidayMatch match = holiday_match(&t);
        bool highlight_holiday = (config_highlight_holidays() && is_configured_holiday(&t));
        bool highlight_sunday = (config_highlight_sundays() && t.tm_wday == 0);
        bool highlight_saturday = (config_highlight_saturdays() && t.tm_wday == 6);
        bool bold = (i == i_today) || highlight_holiday || highlight_sunday || highlight_saturday;
        GColor text_color = (i == i_today) ? gcolor_legible_over(today_color())
                                           : (highlight_holiday ? gcolor_legible_over(holiday_color(match))
                                                                : PBL_IF_COLOR_ELSE(date_color(&t), GColorWhite));
        char buffer[4];
        GFont font = fonts_get_system_font(bold ? CALENDAR_FONT_KEY_BOLD : CALENDAR_FONT_KEY);
        GRect cell_rect = calendar_cell_rect(bounds, i);

#ifdef PBL_COLOR
        if (i != i_today && highlight_holiday) {
            draw_holiday_highlight(ctx, holiday_highlight_rect(cell_rect), match);
        }
#endif
        graphics_context_set_text_color(ctx, text_color);
        graphics_draw_text(ctx,
            (snprintf(buffer, sizeof(buffer), "%d", t.tm_mday), buffer),
            font,
            calendar_text_rect(cell_rect, buffer, font), GTextOverflowModeFill, GTextAlignmentCenter, NULL);
    }
}

void calendar_layer_create(Layer* parent_layer, GRect frame) {
    s_calendar_layer = layer_create(frame);
    layer_set_update_proc(s_calendar_layer, calendar_update_proc);
    calendar_layer_refresh();
    layer_add_child(parent_layer, s_calendar_layer);
    MEMORY_LOG_HEAP("after_calendar_layer_create");
}


void calendar_layer_refresh() {
    // Request redraw (of today's highlight)
    layer_mark_dirty(s_calendar_layer);
}

void calendar_layer_destroy() {
    MEMORY_LOG_HEAP("calendar_layer_destroy:before");
    layer_destroy(s_calendar_layer);
    MEMORY_LOG_HEAP("calendar_layer_destroy:after");
}
