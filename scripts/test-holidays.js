#!/usr/bin/env node

global.localStorage = {
  getItem() {
    return null;
  },
  setItem() {}
};
global.XMLHttpRequest = function XMLHttpRequest() {};

const assert = require('assert');
const holidays = require('../src/pkjs/holidays.js');

const sampleSpain = [
  { date: '2026-01-01', global: true, counties: null, types: ['Public'] },
  { date: '2026-04-06', global: false, counties: ['ES-CT'], types: ['Public'] },
  { date: '2026-09-11', global: false, counties: ['ES-CT'], types: ['Public'] },
  { date: '2026-10-12', global: true, counties: null, types: ['Public'] },
  { date: '2026-10-12', global: true, counties: null, types: ['Bank'] },
  { date: '2026-12-26', global: false, counties: ['ES-CT'], types: ['Public'] },
  { date: '2026-05-02', global: false, counties: ['ES-MD'], types: ['Public'] },
  { date: '2026-06-01', global: true, counties: null, types: ['Observance'] }
];

const sampleUs = [
  { date: '2026-01-01', global: true, counties: null, types: ['Public', 'Bank'] },
  { date: '2026-02-12', global: false, counties: ['US-CA'], types: ['Observance'] },
  { date: '2026-10-12', global: true, counties: null, types: ['Bank'] }
];

const sampleRu = [
  { date: '2026-01-01', global: true, counties: null, types: ['Public'] },
  { date: '2026-03-08', global: true, counties: null, types: ['Public'] },
  { date: '2026-04-01', global: true, counties: null, types: ['Observance'] }
];

assert.deepStrictEqual(
  holidays.filterHolidayDates(sampleSpain, holidays.HOLIDAY_SET_ES_NATIONAL),
  ['2026-01-01', '2026-10-12']
);

assert.deepStrictEqual(
  holidays.filterHolidayDates(sampleSpain, holidays.HOLIDAY_SET_ES_CATALONIA),
  ['2026-01-01', '2026-04-06', '2026-09-11', '2026-10-12', '2026-12-26']
);

assert.deepStrictEqual(
  holidays.filterHolidayDates(sampleUs, holidays.HOLIDAY_SET_US),
  ['2026-01-01', '2026-10-12']
);

assert.deepStrictEqual(
  holidays.filterHolidayDates(sampleRu, holidays.HOLIDAY_SET_RU),
  ['2026-01-01', '2026-03-08']
);

const packed = holidays.packHolidayBits(2026, ['2026-01-01', '2026-12-31', '2027-01-01']);
assert.strictEqual(packed.length, 46);
assert.strictEqual((packed[0] & 1) !== 0, true);
assert.strictEqual((packed[45] & (1 << 4)) !== 0, true);

assert.strictEqual(holidays.normalizeHolidaySet('4'), holidays.HOLIDAY_SET_ES_CATALONIA);
assert.strictEqual(holidays.normalizeHolidaySet('bogus'), holidays.HOLIDAY_SET_NONE);
assert.strictEqual(holidays._isStale({ fetchedAtUtc: '2026-01-01T00:00:00.000Z' }, Date.parse('2026-02-01T00:00:01.000Z')), true);
assert.strictEqual(holidays._isStale({ fetchedAtUtc: '2026-01-15T00:00:00.000Z' }, Date.parse('2026-02-01T00:00:01.000Z')), false);

console.log('Holiday tests passed');
