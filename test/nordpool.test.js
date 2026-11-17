'use strict';

// The Nord Pool demonstration in examples/: the definitions module and
// the command line tool on top of it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const PeriodCalc = require('..');
const nordpool = require('../examples/nordpool');

const CLI = path.join(__dirname, '..', 'examples', 'nordpool-cli');

function utc(y, mo, d, h = 0, mi = 0, s = 0) {
    return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

// Runs the CLI as Helsinki would see it and returns stdout.
function cli(...args) {
    return execFileSync(process.execPath, [ CLI, ...args ],
                        { encoding: 'utf8', env: Object.assign({}, process.env, { TZ: 'Europe/Helsinki' }), stdio: [ 'ignore', 'pipe', 'pipe' ] });
}

function cliJson(...args) {
    return JSON.parse(cli('--json', ...args));
}

test('epoch and specs', function() {
    assert.equal(nordpool.EPOCH, utc(1992, 12, 31, 23));
    assert.equal(nordpool.marketDay.uri, 'tr-period-calc://?epoch=1993-01-01T00:00:00&length=day&tz=CET');
    assert.equal(nordpool.marketHour.uri, 'tr-period-calc://?epoch=725842800&length=3600');
    assert.equal(nordpool.marketQuarter.uri, 'tr-period-calc://?epoch=725842800&length=900');
    for (const kind of nordpool.KINDS) {
        assert.equal(nordpool.calc(kind).byIndex(0).first, nordpool.EPOCH);
    }
    assert.equal(nordpool.marketDay.byIndex(0).last, utc(1993, 1, 1, 23) - 1);
    assert.throws(() => nordpool.calc('week'), /Invalid kind/);
});

test('hour 25 belongs to day 1 and holds quarters 100-103', function() {
    const hour = nordpool.describe('hour', 25);
    assert.equal(hour.period.first, nordpool.EPOCH + (25 * 3600));
    assert.equal(hour.day.index, 1);
    assert.deepEqual(hour.quarters, { first: 100, last: 103, count: 4 });
    const quarter = nordpool.describe('quarter', 100);
    assert.equal(quarter.hour.index, 25);
    assert.equal(quarter.day.index, 1);
    const day = nordpool.describe('day', 1);
    assert.deepEqual(day.hours, { first: 24, last: 47, count: 24 });
    assert.deepEqual(day.quarters, { first: 96, last: 191, count: 96 });
    assert.equal(day.countries.length, 16);
    const r = nordpool.at(nordpool.EPOCH + (25 * 3600) + 1234);
    assert.deepEqual([ r.day.index, r.hour.index, r.quarter.index ], [ 1, 25, 101 ]);
    assert.equal(r.time, nordpool.EPOCH + (25 * 3600) + 1234);
});

test('DST days have 23 and 25 market hours and the hour count stays continuous', function() {
    // EU rules in 1993: last Sunday of March to last Sunday of September
    for (const [ date, hours ] of [ [ '1993-03-28', 23 ], [ '1993-09-26', 25 ], [ '2026-03-29', 23 ], [ '2026-10-25', 25 ], [ '2026-07-01', 24 ] ]) {
        const day = nordpool.marketDay.byDateTime(date + ' 12:00');
        const d = nordpool.describe('day', day.index);
        assert.equal(d.hours.count, hours, date);
        assert.equal(d.quarters.count, hours * 4, date);
        assert.equal(day.last - day.first + 1, hours * 3600, date);
        const before = nordpool.describe('day', day.index - 1);
        const after = nordpool.describe('day', day.index + 1);
        assert.equal(before.hours.last + 1, d.hours.first);
        assert.equal(d.hours.last + 1, after.hours.first);
        // the hour holding the day's first second starts exactly then
        assert.equal(nordpool.marketHour.byIndex(d.hours.first).first, day.first);
    }
    // so hour indexes cannot be turned into days by division
    const day = nordpool.marketDay.byDateTime('2026-07-01 12:00');
    assert.notEqual(nordpool.describe('day', day.index).hours.first, day.index * 24);
});

test('market day on each country clock', function() {
    for (const [ date, cet, eet, gmt ] of [ [ '2026-07-15', '00:00:00', '01:00:00', '23:00:00' ],
                                             [ '2026-01-15', '00:00:00', '01:00:00', '23:00:00' ] ]) {
        const day = nordpool.marketDay.byDateTime(date + ' 12:00');
        const clocks = Object.fromEntries(nordpool.countryClocks(day).map((c) => [ c.name, c ]));
        const next = PeriodCalc.localTime(PeriodCalc.parseDateTime(date) + 86400).dateStr;
        const prev = PeriodCalc.localTime(PeriodCalc.parseDateTime(date) - 86400).dateStr;
        for (const c of [ 'Germany', 'France', 'Norway', 'Sweden', 'Denmark', 'Netherlands', 'Belgium', 'Austria', 'Luxembourg', 'Poland' ]) {
            assert.equal(clocks[c].first, date + 'T' + cet, c);
            assert.equal(clocks[c].last, date + 'T23:59:59', c);
        }
        for (const c of [ 'Finland', 'Estonia', 'Latvia', 'Lithuania' ]) {
            assert.equal(clocks[c].first, date + 'T' + eet, c);
            assert.equal(clocks[c].last, next + 'T00:59:59', c);
        }
        for (const c of [ 'Ireland', 'Portugal' ]) {
            assert.equal(clocks[c].first, prev + 'T' + gmt, c);
            assert.equal(clocks[c].last, date + 'T22:59:59', c);
        }
    }
});

test('CLI: now and timestamps', function() {
    const now = cliJson();
    assert.deepEqual(now.zone, { timeZone: 'Europe/Helsinki', source: 'local' });
    assert.ok(Math.abs(now.time.time - (Date.now() / 1000)) < 30);
    assert.equal(now.time.tz.timeZone, 'Europe/Helsinki');
    assert.equal(now.day.kind, 'day');
    assert.ok((now.hour.first.time <= now.time.time) && (now.time.time <= now.hour.last.time));

    // hour 25 = 1993-01-02 01:00 CET = 00:00Z = 02:00 Helsinki
    const t = nordpool.EPOCH + (25 * 3600);
    for (const args of [ [ String(t) ],
                         [ '1993-01-02 02:00' ],
                         [ '1993-01-02T02:00:00' ],
                         [ '--local', '1993-01-02 02:00' ],
                         [ '--utc', '1993-01-02 00:00' ],
                         [ '--utc', '1993-01-02' ],
                         [ '--tz=CET', '1993-01-02 01:00' ],
                         [ '--tz', 'Europe/Dublin', '1993-01-02 00:00' ],
                         [ '--utc', '1993-01-02T01:00:00+01:00' ],
                         [ '--tz=Europe/Helsinki', '1993-01-01T19:00:00-05:00' ],
                         [ '1993-01-02T00:00Z' ] ]) {
        const r = cliJson(...args);
        assert.equal(r.time.time, t, args.join(' '));
        assert.deepEqual([ r.day.index, r.hour.index, r.quarter.index ], [ 1, 25, 100 ], args.join(' '));
    }
    const r = cliJson('--tz=Europe/Dublin', String(t));
    assert.deepEqual(r.zone, { timeZone: 'Europe/Dublin', source: 'tz' });
    assert.equal(r.time.utc, '1993-01-02T00:00:00Z');
    assert.deepEqual(r.time.market, { timeZone: 'CET', dateTime: '1993-01-02T01:00:00', offset: 3600 });
    assert.deepEqual(r.time.local, { timeZone: 'Europe/Helsinki', dateTime: '1993-01-02T02:00:00', offset: 7200 });
    assert.deepEqual(r.time.tz, { timeZone: 'Europe/Dublin', dateTime: '1993-01-02T00:00:00', offset: 0 });
    assert.equal(r.hour.uri, 'tr-period-calc://25?epoch=725842800&length=3600');
    assert.equal(r.hour.length, 3600);
    assert.equal(r.day.last.time, r.day.first.time + 86400 - 1);
    assert.equal(cliJson('--utc', String(t)).zone.source, 'utc');

    const text = cli(String(t));
    assert.match(text, /^Time     1993-01-02 02:00:00  Europe\/Helsinki \(local\)\n/);
    assert.match(text, /\nDay        1  1993-01-02 01:00:00 – 1993-01-03 00:59:59\n/);
    assert.match(text, /\nHour      25  1993-01-02 02:00:00 – 1993-01-02 02:59:59\n/);
    assert.match(text, /\nQuarter  100  1993-01-02 02:00:00 – 1993-01-02 02:14:59\n$/);
});

test('CLI: limits and describe', function() {
    const day = cliJson('day', '1');
    assert.equal(day.period.index, 1);
    assert.equal(day.period.first.time, nordpool.EPOCH + 86400);
    assert.equal(day.period.first.local.dateTime, '1993-01-02T01:00:00');
    assert.equal(day.period.last.utc, '1993-01-02T23:00:00Z'.replace('23:00:00', '22:59:59'));
    assert.match(cli('--utc', 'hour', '25'), /^Hour 25  \(times in UTC \(utc\)\)\n  first  1993-01-02 00:00:00  725932800\n  last   1993-01-02 00:59:59  725936399\n$/);

    const hour = cliJson('describe', 'hour', '25');
    assert.equal(hour.period.index, 25);
    assert.equal(hour.day.index, 1);
    assert.deepEqual(hour.quarters, { first: 100, last: 103, count: 4 });
    assert.equal(hour.hour, undefined);
    assert.equal(hour.countries.find((c) => c.name === 'Finland').first, '1993-01-02T02:00:00');
    const quarter = cliJson('--utc', 'describe', 'quarter', '100');
    assert.equal(quarter.hour.index, 25);
    assert.equal(quarter.day.index, 1);
    const dayText = cli('--tz=CET', 'describe', 'day', '1');
    assert.match(dayText, /^Day 1  \(times in CET \(tz\)\)\n  uri       tr-period-calc:\/\/1\?epoch=1993-01-01T00:00:00&length=day&tz=CET\n/);
    assert.match(dayText, /\n  length    86400 s \(24 h\)\n  hours     24 – 47  \(24\)\n  quarters  96 – 191  \(96\)\n  on each country's clock\n/);
    assert.match(dayText, /\n    Finland +Europe\/Helsinki +1993-01-02 01:00:00 – 1993-01-03 00:59:59\n/);
    assert.match(dayText, /\n    Ireland +Europe\/Dublin +1993-01-01 23:00:00 – 1993-01-02 22:59:59\n/);
    const dst = cliJson('describe', 'day', String(nordpool.marketDay.byDateTime('2026-03-29 12:00').index));
    assert.equal(dst.hours.count, 23);
    assert.equal(dst.period.length, 23 * 3600);
});

test('CLI: errors', function() {
    for (const args of [ [ '--utc', '--local' ],
                         [ '--utc', '--tz=UTC' ],
                         [ '--local', '--tz=Europe/Oslo' ],
                         [ '--tz=Mars/Phobos' ],
                         [ 'week', '1' ],
                         [ 'day' ],
                         [ 'day', 'x' ],
                         [ 'day', '1', '2' ],
                         [ 'describe', 'day' ],
                         [ 'describe', 'month', '1' ],
                         [ 'yesterday' ],
                         [ '1993-01-02', '01:00' ],
                         [ '1993-13-01' ] ]) {
        assert.throws(() => cli(...args), (e) => (e.status === 1), args.join(' '));
    }
});
