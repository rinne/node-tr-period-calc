'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const PeriodCalc = require('..');

function utc(y, mo, d, h = 0, mi = 0, s = 0) {
    return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

function iso(t) {
    return new Date(t * 1000).toISOString().slice(0, 19) + 'Z';
}

// Every period must be exactly what byIndex says, and glue to its
// neighbours without gap or overlap.
function checkPeriod(pc, p, t) {
    assert.deepEqual(pc.byIndex(p.index), p);
    if (t !== undefined) {
        assert.ok((p.first <= t) && (t <= p.last), 'time ' + iso(t) + ' inside ' + p.uri);
    }
    assert.equal(pc.byIndex(p.index + 1).first, p.last + 1, 'next glues to ' + p.uri);
    assert.equal(pc.byIndex(p.index - 1).last, p.first - 1, 'previous glues to ' + p.uri);
    assert.equal(PeriodCalc.periodByUri(p.uri).uri, p.uri);
    assert.equal(pc.byUri(p.uri).index, p.index);
}

// ---- fixed-length periods ----

test('fixed periods: the sketch from the design', function() {
    const pc = new PeriodCalc('tr-period-calc://?epoch=1788964903&length=600');
    assert.equal(pc.type, 'fixed');
    assert.equal(pc.uri, 'tr-period-calc://?epoch=1788964903&length=600');
    assert.deepEqual(pc.spec, { epoch: 1788964903, length: 600, timeZone: 'UTC' });
    const p = pc.byIndex(1231);
    assert.deepEqual(p, { index: 1231,
                          first: 1788964903 + (1231 * 600),
                          last: 1788964903 + (1232 * 600) - 1,
                          uri: 'tr-period-calc://1231?epoch=1788964903&length=600',
                          spec: pc.spec });
    assert.ok(Object.isFrozen(p));
    assert.equal(pc.byTime(p.first).index, 1231);
    assert.equal(pc.byTime(p.last).index, 1231);
    assert.equal(pc.byTime(p.first - 1).index, 1230);
    assert.equal(pc.byTime(p.last + 1).index, 1232);
    assert.equal(pc.byTime(1788964903).index, 0);
    assert.equal(pc.byTime(1788964902).index, -1);
    assert.equal(pc.byTime(new Date((p.first * 1000) + 999)).index, 1231);
    assert.equal(pc.byTime(p.first + 0.999).index, 1231);
    checkPeriod(pc, p, p.first + 42);
    checkPeriod(pc, pc.byIndex(-7), undefined);
});

test('fixed periods never drift from the UTC grid', function() {
    const pc = new PeriodCalc({ epoch: utc(2026, 9, 9, 12), length: 900 });
    for (const k of [ -100000, -1, 0, 1, 12345, 3000000 ]) {
        const p = pc.byIndex(k);
        const l = PeriodCalc.localTime(p.first);
        assert.equal(l.second, 0);
        assert.equal(l.minute % 15, 0);
        assert.equal(p.last - p.first + 1, 900);
    }
});

test('fixed periods: epoch given as a local date-time', function() {
    const a = new PeriodCalc({ epoch: '2026-01-01', length: 900, timeZone: 'Europe/Helsinki' });
    assert.equal(a.type, 'fixed');
    assert.deepEqual(a.spec, { epoch: utc(2025, 12, 31, 22), length: 900, timeZone: 'UTC' });
    assert.equal(a.uri, 'tr-period-calc://?epoch=' + utc(2025, 12, 31, 22) + '&length=900');
    const b = new PeriodCalc('tr-period-calc://?epoch=2026-01-01T00:00:00&length=900&tz=Europe/Helsinki');
    assert.ok(a.equals(b));
    const c = new PeriodCalc({ epoch: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 500)), length: '900' });
    assert.equal(c.spec.epoch, utc(2026, 1, 1));
    // a zone with nothing to act on is refused, not ignored
    assert.throws(() => new PeriodCalc({ epoch: 0, length: 900, timeZone: 'Europe/Helsinki' }), /Invalid spec/);
    assert.throws(() => new PeriodCalc('tr-period-calc://?epoch=0&length=900&tz=Europe/Helsinki'), /Invalid spec/);
    assert.doesNotThrow(() => new PeriodCalc({ epoch: 0, length: 900, timeZone: 'utc' }));
});

test('byTime defaults to now', function() {
    const pc = new PeriodCalc({ epoch: 0, length: 60 });
    const before = Math.floor(Date.now() / 1000);
    const p = pc.byTime();
    const after = Math.floor(Date.now() / 1000);
    assert.ok((p.first <= after) && (p.last >= before));
});

// ---- URIs ----

test('URI parsing and building', function() {
    const { index, spec } = PeriodCalc.parseUri('tr-period-calc://1231?epoch=1788964903&length=600');
    assert.equal(index, 1231);
    assert.deepEqual(spec, { epoch: 1788964903, length: 600, timeZone: 'UTC' });
    assert.equal(PeriodCalc.parseUri('tr-period-calc://?epoch=1788964903&length=600').index, undefined);
    assert.equal(PeriodCalc.parseUri('tr-period-calc://-5?epoch=1&length=600').index, -5);
    assert.equal(PeriodCalc.parseUri('tr-period-calc://0?epoch=1&length=600').index, 0);
    // lenient on the way in: case, parameter order, trailing slash, encoding
    const p = PeriodCalc.periodByUri('TR-Period-Calc://12/?tz=Europe%2FHelsinki&length=month&epoch=2026-01-01');
    assert.equal(p.uri, 'tr-period-calc://12?epoch=2026-01-01T00:00:00&length=month&tz=Europe/Helsinki');
    assert.equal(PeriodCalc.parseUri('tr-period-calc:///?epoch=1&length=600').index, undefined);
    // an index in the constructor input is ignored
    assert.equal(new PeriodCalc(p.uri).uri, 'tr-period-calc://?epoch=2026-01-01T00:00:00&length=month&tz=Europe/Helsinki');
    // characters that need escaping in a zone name
    const g = new PeriodCalc({ epoch: '2026-01-01', length: 'day', timeZone: 'Etc/GMT+3' });
    assert.equal(g.uri, 'tr-period-calc://?epoch=2026-01-01T00:00:00&length=day&tz=Etc/GMT%2B3');
    assert.equal(new PeriodCalc(g.uri).spec.timeZone, 'Etc/GMT+3');
    assert.equal(g.byIndex(0).first, utc(2026, 1, 1, 3));
    // '+' is a literal plus, not a space; a space must be percent-encoded
    assert.ok(new PeriodCalc('tr-period-calc://?epoch=2026-01-01&length=day&tz=Etc/GMT+3').equals(g));
    assert.equal(new PeriodCalc('tr-period-calc://?epoch=2026-01-01%2008:00&length=day').spec.epoch, '2026-01-01T08:00:00');
    assert.ok(new PeriodCalc('tr-period-calc://?%65poch=2026-01-01&length=day&tz=Etc%2FGMT%2B3&').equals(g));
    // toString / toJSON
    assert.equal(String(g), g.uri);
    assert.equal(JSON.stringify({ g }), JSON.stringify({ g: g.uri }));
    assert.ok(new PeriodCalc(JSON.parse(JSON.stringify(g))).equals(g));
});

test('invalid URIs', function() {
    for (const bad of [ 'tr-period-calc://?epoch=1',
                        'tr-period-calc://?length=600',
                        'tr-period-calc://?epoch=1&length=600&foo=1',
                        'tr-period-calc://?epoch=1&epoch=2&length=600',
                        'tr-period-calc://?epoch=1&length=600#frag',
                        'tr-period-calc:?epoch=1&length=600',
                        'tr-period-calc://abc?epoch=1&length=600',
                        'tr-period-calc://007?epoch=1&length=600',
                        'tr-period-calc://-0?epoch=1&length=600',
                        'tr-period-calc://1.5?epoch=1&length=600',
                        'tr-period-calc://99999999999999999999?epoch=1&length=600',
                        'tr-period-calc://1?',
                        'tr-period-calc://1',
                        'tr-period-calc://?epoch=1&length=600&tz',
                        'tr-period-calc://?epoch=1&length=%6',
                        'tr-period-calc://?epoch=1&length=600&tz=Europe%ZZHelsinki',
                        'period-idx://1?epoch=1&length=600',
                        'http://1?epoch=1&length=600',
                        ' tr-period-calc://?epoch=1&length=600',
                        '',
                        42,
                        null ]) {
        assert.throws(() => PeriodCalc.parseUri(bad), /Invalid URI/, JSON.stringify(bad));
    }
    for (const bad of [ 'tr-period-calc://?epoch=1&length=0',
                        'tr-period-calc://?epoch=1&length=-600',
                        'tr-period-calc://?epoch=1&length=0600',
                        'tr-period-calc://?epoch=1&length=600.5',
                        'tr-period-calc://?epoch=1&length=fortnight',
                        'tr-period-calc://?epoch=1&length=months',
                        'tr-period-calc://?epoch=1&length=0month',
                        'tr-period-calc://?epoch=1.5&length=600',
                        'tr-period-calc://?epoch=+1&length=600',
                        'tr-period-calc://?epoch=2026-01-01+08:00&length=600',
                        'tr-period-calc://?epoch=&length=600',
                        'tr-period-calc://?epoch=2026-02-30&length=600',
                        'tr-period-calc://?epoch=2026-01-01T24:00&length=600',
                        'tr-period-calc://?epoch=2026-01-01T00:00:00Z&length=600',
                        'tr-period-calc://?epoch=999-01-01&length=day' ]) {
        assert.throws(() => PeriodCalc.parseUri(bad), /Invalid spec/, bad);
    }
    assert.throws(() => PeriodCalc.parseUri('tr-period-calc://?epoch=1&length=day&tz=Europe/Nowhere'), /Invalid time zone/);
    assert.throws(() => PeriodCalc.parseUri('tr-period-calc://?epoch=1&length=day&tz='), /Invalid time zone/);
    // a spec URI is not a period
    assert.throws(() => PeriodCalc.periodByUri('tr-period-calc://?epoch=1&length=600'), /Invalid URI/);
});

// ---- spec objects ----

test('spec object forms', function() {
    const uri = 'tr-period-calc://?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York';
    const forms = [ { epoch: '2026-01-05T08:00:00', length: 'week', timeZone: 'America/New_York' },
                    { epoch: '2026-01-05 08:00', length: 'week', timeZone: 'america/new york' },
                    { epoch: utc(2026, 1, 5, 13), length: 'week', timeZone: 'America/New_York' },
                    { epoch: '' + utc(2026, 1, 5, 13), length: '1week', timeZone: 'America/New_York' },
                    { epoch: new Date(utc(2026, 1, 5, 13) * 1000), length: 'week', timeZone: 'America/New_York' },
                    { calendarEpoch: '2026-01-05 08:00', calendarPeriodLength: 'week', timeZone: 'America/New_York' },
                    { epoch: '2026-01-05T08:00:00', length: 'week', timeZone: 'America/New_York', extra: undefined } ];
    for (const f of forms) {
        const pc = new PeriodCalc(f);
        assert.equal(pc.uri, uri, JSON.stringify(f));
        assert.equal(pc.type, 'calendar');
    }
    const fixed = 'tr-period-calc://?epoch=1788964903&length=600';
    for (const f of [ { epoch: 1788964903, length: 600 },
                      { epoch: '1788964903', length: '600', timeZone: null },
                      { periodEpoch: 1788964903, periodLength: 600 },
                      { periodEpoch: 1788964903, periodLength: 600, timeZone: 'UTC' } ]) {
        assert.equal(new PeriodCalc(f).uri, fixed, JSON.stringify(f));
    }
    // copies
    const a = new PeriodCalc(fixed);
    assert.equal(new PeriodCalc(a).uri, fixed);
    assert.equal(new PeriodCalc(a.spec).uri, fixed);
    assert.equal(new PeriodCalc(a.byIndex(3).spec).uri, fixed);
    assert.ok(a.equals(fixed));
    assert.ok(a.equals({ periodEpoch: 1788964903, periodLength: 600 }));
    assert.ok(! a.equals({ epoch: 1788964903, length: 601 }));
    assert.ok(! a.equals({ epoch: 1788964903 + 600, length: 600 }));
    assert.throws(() => new PeriodCalc('x'), /Invalid URI/);
    for (const bad of [ undefined, null, 42, [], {},
                        { epoch: 1 },
                        { length: 600 },
                        { epoch: 1, length: 600, tz: 'UTC' },
                        { epoch: 1, length: 600, timezone: 'UTC' },
                        { epoch: 1, length: 600, foo: 1 },
                        { epoch: 1, periodLength: 600 },
                        { periodEpoch: 1, calendarPeriodLength: 'day' },
                        { epoch: 1.5, length: 600 },
                        { epoch: 1, length: 600.5 },
                        { epoch: 1, length: 0 },
                        { epoch: 1, length: -600 },
                        { epoch: 1, length: '600s' },
                        { epoch: 1, length: 'Month' },
                        { epoch: 1, length: '99999999999999999999day' },
                        { epoch: NaN, length: 600 },
                        { epoch: PeriodCalc.MAX_TIME + 1, length: 600 },
                        { epoch: PeriodCalc.MIN_TIME - 1, length: 'day' },
                        { epoch: new Date(NaN), length: 600 },
                        { epoch: '2026-01-01', length: [ 600 ] } ]) {
        assert.throws(() => new PeriodCalc(bad), /Invalid spec/, JSON.stringify(bad));
    }
    assert.throws(() => new PeriodCalc({ epoch: 1, length: 'day', timeZone: 42 }), /Invalid time zone/);
    assert.throws(() => new PeriodCalc({ epoch: 1, length: 'day', timeZone: 'Mars/Olympus_Mons' }), /Invalid time zone/);
});

test('time zone normalization', function() {
    const n = PeriodCalc.normalizeTimeZone;
    assert.equal(n(undefined), 'UTC');
    assert.equal(n(null), 'UTC');
    assert.equal(n('utc'), 'UTC');
    assert.equal(n('Etc/UTC'), 'UTC');
    assert.equal(n('GMT'), 'UTC');
    assert.equal(n('Europe/Helsinki'), 'Europe/Helsinki');
    assert.equal(n('europe/helsinki'), 'Europe/Helsinki');
    assert.equal(n('EUROPE/HELSINKI'), 'Europe/Helsinki');
    assert.equal(n('America/New York'), 'America/New_York');
    assert.equal(n('america/new-york'), 'America/New_York');
    assert.equal(n('Australia/Lord_Howe'), 'Australia/Lord_Howe');
    // links Intl accepts but does not list keep the given spelling
    assert.equal(n('US/Eastern'), 'US/Eastern');
    assert.equal(new PeriodCalc({ epoch: '2026-01-01', length: 'day', timeZone: 'US/Eastern' }).byIndex(0).first, utc(2026, 1, 1, 5));
    for (const bad of [ '', ' ', 42, {}, 'Europe/Nowhere', 'UTC+3', 'Z' ]) {
        assert.throws(() => n(bad), /Invalid time zone/, JSON.stringify(bad));
    }
});

// ---- calendar periods ----

test('calendar months in Helsinki', function() {
    const pc = new PeriodCalc({ epoch: '2026-01-01', length: 'month', timeZone: 'Europe/Helsinki' });
    assert.equal(pc.uri, 'tr-period-calc://?epoch=2026-01-01T00:00:00&length=month&tz=Europe/Helsinki');
    const p = pc.byDateTime('2026-03-15 12:00');
    assert.equal(p.index, 2);
    assert.equal(p.first, utc(2026, 2, 28, 22));        // 2026-03-01T00:00 EET
    assert.equal(p.last, utc(2026, 3, 31, 21) - 1);     // 2026-04-01T00:00 EEST, less one
    assert.equal(p.uri, 'tr-period-calc://2?epoch=2026-01-01T00:00:00&length=month&tz=Europe/Helsinki');
    checkPeriod(pc, p, utc(2026, 3, 15, 10));
    assert.equal(pc.byTime(p.first - 1).index, 1);
    assert.equal(pc.byTime(p.last + 1).index, 3);
    assert.equal(pc.byDateTime('2025-12-31 23:59:59').index, -1);
    assert.equal(pc.byDateTime('2020-06-15').index, -67);
    assert.equal(pc.byIndex(-67).first, PeriodCalc.parseDateTime('2020-06-01', 'Europe/Helsinki'));
    // a UTC-referenced lookup into a Helsinki spec
    assert.equal(pc.byDateTime('2026-02-28 22:00', 'UTC').index, 2);
    assert.equal(pc.byDateTime('2026-02-28 21:59:59', 'UTC').index, 1);
    assert.equal(pc.byTime(new Date('2026-02-28T22:00:00Z')).index, 2);
});

test('week starting Monday 08:00 in New York', function() {
    const pc = new PeriodCalc({ epoch: '2026-01-05 08:00', length: 'week', timeZone: 'America/New_York' });
    assert.equal(pc.byIndex(0).first, utc(2026, 1, 5, 13));               // EST
    assert.equal(PeriodCalc.localTime(pc.byIndex(0).first, 'America/New_York').weekday, 1);
    const p8 = pc.byDateTime('2026-03-09 07:59:59');
    const p9 = pc.byDateTime('2026-03-09 08:00');
    assert.equal(p8.index, 8);
    assert.equal(p9.index, 9);
    assert.equal(p8.first, utc(2026, 3, 2, 13));                          // Mon 08:00 EST
    assert.equal(p9.first, utc(2026, 3, 9, 12));                          // Mon 08:00 EDT
    assert.equal(p8.last, p9.first - 1);
    assert.equal(p8.last - p8.first + 1, (7 * 86400) - 3600);             // DST started inside
    const p42 = pc.byDateTime('2026-11-02 07:59:59');
    assert.equal(p42.last - p42.first + 1, (7 * 86400) + 3600);           // DST ended inside
    for (let k = -200; k <= 200; k++) {
        const p = pc.byIndex(k);
        const l = PeriodCalc.localTime(p.first, 'America/New_York');
        assert.equal(l.weekday, 1, p.uri);
        assert.equal(l.timeStr, '08:00:00', p.uri);
        assert.equal(pc.byIndex(k + 1).first, p.last + 1);
    }
});

test('calendar days across DST changes', function() {
    const pc = new PeriodCalc({ epoch: '2026-01-01', length: 'day', timeZone: 'Europe/Helsinki' });
    const spring = pc.byDateTime('2026-03-29 12:00');
    const autumn = pc.byDateTime('2026-10-25 12:00');
    assert.equal(spring.last - spring.first + 1, 23 * 3600);
    assert.equal(autumn.last - autumn.first + 1, 25 * 3600);
    assert.equal(spring.first, utc(2026, 3, 28, 22));
    assert.equal(autumn.first, utc(2026, 10, 24, 21));
    checkPeriod(pc, spring, utc(2026, 3, 29, 1));
    checkPeriod(pc, autumn, utc(2026, 10, 25, 1));
    const days = pc.range(utc(2026, 3, 28, 22), utc(2026, 3, 31, 21));
    assert.deepEqual(days.map((p) => p.index), [ 87, 88, 89, 90 ]);
    assert.deepEqual(days.map((p) => PeriodCalc.localTime(p.first, 'Europe/Helsinki').dateTimeStr),
                     [ '2026-03-29T00:00:00', '2026-03-30T00:00:00', '2026-03-31T00:00:00', '2026-04-01T00:00:00' ]);
});

test('epoch time-of-day inside a DST transition stays consistent', function() {
    // Helsinki: 03:30 does not exist on 2026-03-29 and happens twice on 2026-10-25.
    const pc = new PeriodCalc({ epoch: '2026-01-01 03:30', length: 'day', timeZone: 'Europe/Helsinki' });
    const gapDay = pc.byDateTime('2026-03-29 12:00');
    assert.equal(gapDay.first, utc(2026, 3, 29, 1, 30));                   // 04:30 EEST, pushed forward
    assert.equal(PeriodCalc.localTime(gapDay.first, 'Europe/Helsinki').timeStr, '04:30:00');
    const overlapDay = pc.byDateTime('2026-10-25 12:00');
    assert.equal(overlapDay.first, utc(2026, 10, 25, 0, 30));              // the first 03:30 (EEST)
    // 03:15 on the second pass through the hour is by the clock before the
    // epoch time, but by the instant it is after the period boundary.
    const secondPass = utc(2026, 10, 25, 1, 15);
    assert.equal(PeriodCalc.localTime(secondPass, 'Europe/Helsinki').dateTimeStr, '2026-10-25T03:15:00');
    assert.equal(pc.byTime(secondPass).index, overlapDay.index);
    for (const day of [ utc(2026, 3, 29), utc(2026, 10, 25), utc(2027, 3, 28), utc(2027, 10, 31) ]) {
        for (let t = day - 86400; t <= day + 86400; t += 300) {
            checkPeriod(pc, pc.byTime(t), t);
        }
    }
});

test('a unix-second epoch in a repeated hour resolves to the first occurrence', function() {
    // Helsinki 2026-10-25: 03:30 EEST is 00:30Z, 03:30 EET is 01:30Z.
    const second = utc(2026, 10, 25, 1, 30);
    const pc = new PeriodCalc({ epoch: second, length: 'day', timeZone: 'Europe/Helsinki' });
    assert.equal(pc.spec.epoch, '2026-10-25T03:30:00');
    assert.equal(pc.byIndex(0).first, second - 3600);
    assert.equal(pc.byTime(second).index, 0);
});

test('a calendar period skipped entirely by the clock is empty', function() {
    // Samoa moved across the date line: 2011-12-29 23:59:59 (-10) was
    // followed by 2011-12-31 00:00:00 (+14), so 2011-12-30 never happened.
    const pc = new PeriodCalc({ epoch: '2011-12-25', length: 'day', timeZone: 'Pacific/Apia' });
    const skipped = pc.byIndex(5);
    assert.equal(skipped.first, utc(2011, 12, 30, 10));
    assert.equal(skipped.last, skipped.first - 1);
    assert.equal(pc.byIndex(4).last, skipped.first - 1);
    assert.equal(pc.byIndex(6).first, skipped.first);
    assert.equal(PeriodCalc.localTime(pc.byIndex(6).first, 'Pacific/Apia').dateTimeStr, '2011-12-31T00:00:00');
    // no instant belongs to it, but a range across it lists it
    assert.equal(pc.byTime(skipped.first).index, 6);
    assert.equal(pc.byTime(skipped.first - 1).index, 4);
    assert.deepEqual(pc.range(pc.byIndex(4).first, pc.byIndex(6).first).map((p) => p.index), [ 4, 5, 6 ]);
    assert.deepEqual(PeriodCalc.periodByUri(skipped.uri), skipped);
});

test('periods stay contiguous when DST changes exactly at the boundary time', function() {
    // São Paulo left DST at 2018-02-18 00:00 (-02) -> 2018-02-17 23:00 (-03)
    // and had entered it at 2017-10-15 00:00 (-03) -> 01:00 (-02).
    const pc = new PeriodCalc({ epoch: '2017-01-01', length: 'day', timeZone: 'America/Sao_Paulo' });
    const feb17 = pc.byDateTime('2018-02-17 12:00');
    const feb18 = pc.byDateTime('2018-02-18 12:00');
    assert.equal(feb18.first, utc(2018, 2, 18, 3));
    assert.equal(feb17.last, feb18.first - 1);
    assert.equal(feb17.last - feb17.first + 1, 25 * 3600);
    assert.equal(pc.byTime(utc(2018, 2, 18, 2, 30)).index, feb17.index);   // second pass of 23:30
    const oct15 = pc.byDateTime('2017-10-15 12:00');
    assert.equal(oct15.first, utc(2017, 10, 15, 3));                        // 01:00 -02: midnight did not exist
    assert.equal(oct15.last - oct15.first + 1, 23 * 3600);
    assert.equal(pc.byIndex(oct15.index - 1).last, oct15.first - 1);
    for (let t = utc(2017, 10, 14); t <= utc(2017, 10, 16); t += 300) {
        checkPeriod(pc, pc.byTime(t), t);
    }
    for (let t = utc(2018, 2, 17); t <= utc(2018, 2, 19); t += 300) {
        checkPeriod(pc, pc.byTime(t), t);
    }
});

test('half-hour DST shift (Lord Howe Island)', function() {
    const pc = new PeriodCalc({ epoch: '2026-01-01 02:15', length: 'day', timeZone: 'Australia/Lord_Howe' });
    const gap = pc.byDateTime('2026-10-04 12:00');
    assert.equal(PeriodCalc.localTime(gap.first, 'Australia/Lord_Howe').timeStr, '02:45:00');
    assert.equal(gap.first, utc(2026, 10, 3, 15, 45));
    for (let t = utc(2026, 10, 3); t <= utc(2026, 10, 5); t += 300) {
        checkPeriod(pc, pc.byTime(t), t);
    }
    for (let t = utc(2026, 4, 4); t <= utc(2026, 4, 6); t += 300) {
        checkPeriod(pc, pc.byTime(t), t);
    }
});

test('month-end and leap-day epochs are constrained', function() {
    const pc = new PeriodCalc({ epoch: '2026-01-31', length: 'month' });
    const starts = [ 0, 1, 2, 3, 12, 13, 25 ].map((k) => [ k, iso(pc.byIndex(k).first) ]);
    assert.deepEqual(starts, [ [ 0, '2026-01-31T00:00:00Z' ],
                               [ 1, '2026-02-28T00:00:00Z' ],
                               [ 2, '2026-03-31T00:00:00Z' ],
                               [ 3, '2026-04-30T00:00:00Z' ],
                               [ 12, '2027-01-31T00:00:00Z' ],
                               [ 13, '2027-02-28T00:00:00Z' ],
                               [ 25, '2028-02-29T00:00:00Z' ] ]);
    assert.equal(pc.byTime(utc(2026, 2, 28)).index, 1);
    assert.equal(pc.byTime(utc(2026, 2, 28) - 1).index, 0);
    assert.equal(pc.byTime(utc(2026, 3, 30, 23, 59, 59)).index, 1);
    assert.equal(pc.byTime(utc(2026, 3, 31)).index, 2);
    for (let t = utc(2025, 12, 1); t <= utc(2028, 4, 1); t += 3 * 3600 + 7) {
        checkPeriod(pc, pc.byTime(t), t);
    }
    const y = new PeriodCalc({ epoch: '2024-02-29 12:00', length: 'year', timeZone: 'Europe/Helsinki' });
    assert.deepEqual([ 0, 1, 2, 3, 4 ].map((k) => PeriodCalc.localTime(y.byIndex(k).first, 'Europe/Helsinki').dateTimeStr),
                     [ '2024-02-29T12:00:00', '2025-02-28T12:00:00', '2026-02-28T12:00:00', '2027-02-28T12:00:00', '2028-02-29T12:00:00' ]);
    assert.equal(y.byDateTime('2025-02-28 11:59:59').index, 0);
    assert.equal(y.byDateTime('2025-02-28 12:00:00').index, 1);
    assert.equal(y.byDateTime('2028-02-28 23:59:59').index, 3);
    assert.equal(y.byDateTime('2028-02-29 12:00:00').index, 4);
});

test('multiples of calendar units', function() {
    const q = new PeriodCalc({ epoch: '2026-01-01', length: '3month', timeZone: 'Europe/Helsinki' });
    assert.equal(q.spec.length, '3month');
    assert.equal(q.uri, 'tr-period-calc://?epoch=2026-01-01T00:00:00&length=3month&tz=Europe/Helsinki');
    assert.equal(q.byDateTime('2026-03-31 23:59:59').index, 0);
    assert.equal(q.byDateTime('2026-04-01').index, 1);
    assert.equal(q.byDateTime('2025-12-31').index, -1);
    assert.equal(q.byDateTime('2025-10-01').index, -1);
    assert.equal(q.byDateTime('2025-09-30').index, -2);
    assert.equal(PeriodCalc.localTime(q.byIndex(7).first, 'Europe/Helsinki').dateTimeStr, '2027-10-01T00:00:00');
    for (let t = utc(2024, 1, 1); t <= utc(2028, 1, 1); t += 5 * 3600 + 11) {
        checkPeriod(q, q.byTime(t), t);
    }
    const f = new PeriodCalc({ epoch: '2026-01-05', length: '2week', timeZone: 'America/New_York' });
    assert.equal(f.byDateTime('2026-01-18 23:59:59').index, 0);
    assert.equal(f.byDateTime('2026-01-19').index, 1);
    assert.equal(f.byDateTime('2026-01-04 23:59:59').index, -1);
    assert.equal(f.byDateTime('2025-12-21 23:59:59').index, -2);
    assert.equal(new PeriodCalc({ epoch: '2026-01-01', length: '1month' }).spec.length, 'month');
    assert.equal(new PeriodCalc({ epoch: '2026-01-01', length: '12month' }).spec.length, '12month');
    assert.equal(new PeriodCalc({ epoch: '2026-01-01', length: '7day' }).byIndex(3).first, utc(2026, 1, 22));
    // a year is twelve months and a week is seven days, boundary for boundary
    const y = new PeriodCalc({ epoch: '2024-02-29', length: 'year' });
    const m12 = new PeriodCalc({ epoch: '2024-02-29', length: '12month' });
    for (let k = -30; k <= 30; k++) {
        assert.deepEqual([ y.byIndex(k).first, y.byIndex(k).last ], [ m12.byIndex(k).first, m12.byIndex(k).last ]);
    }
});

test('range, byUri and spec mismatch', function() {
    const pc = new PeriodCalc({ epoch: 1000, length: 60 });
    const r = pc.range(1000 + 130, 1000 + 400);
    assert.deepEqual(r.map((p) => p.index), [ 2, 3, 4, 5, 6 ]);
    assert.deepEqual(r, [ 2, 3, 4, 5, 6 ].map((k) => pc.byIndex(k)));
    assert.deepEqual(pc.range(1000, 1000), [ pc.byIndex(0) ]);
    assert.throws(() => pc.range(2000, 1000), /Invalid time/);
    const w = new PeriodCalc({ epoch: '2026-01-05 08:00', length: 'week', timeZone: 'America/New_York' });
    const wr = w.range(utc(2026, 3, 1), utc(2026, 4, 1));
    assert.deepEqual(wr.map((p) => p.index), [ 7, 8, 9, 10, 11, 12 ]);
    assert.deepEqual(wr, wr.map((p) => w.byIndex(p.index)));
    assert.equal(pc.byUri('tr-period-calc://5?epoch=1000&length=60').index, 5);
    assert.throws(() => pc.byUri('tr-period-calc://5?epoch=1000&length=61'), /Spec mismatch/);
    assert.throws(() => pc.byUri('tr-period-calc://?epoch=1000&length=60'), /Invalid URI/);
    assert.throws(() => pc.byUri('tr-period-calc://5?epoch=1000&length=60&x=1'), /Invalid URI/);
});

test('localTime and parseDateTime', function() {
    const t = utc(2026, 3, 29, 1, 30);
    const l = PeriodCalc.localTime(t, 'Europe/Helsinki');
    assert.deepEqual(l, { time: t,
                          timeZone: 'Europe/Helsinki',
                          year: 2026, month: 3, day: 29, hour: 4, minute: 30, second: 0,
                          weekday: 0,
                          offset: 3 * 3600,
                          dateStr: '2026-03-29',
                          timeStr: '04:30:00',
                          dateTimeStr: '2026-03-29T04:30:00' });
    assert.equal(PeriodCalc.localTime(t).dateTimeStr, '2026-03-29T01:30:00');
    assert.equal(PeriodCalc.localTime(t).offset, 0);
    assert.equal(PeriodCalc.localTime(new Date(t * 1000 + 500), 'utc').time, t);
    assert.equal(PeriodCalc.localTime(utc(1850, 6, 15, 10, 20, 11), 'Europe/Helsinki').dateTimeStr, '1850-06-15T12:00:00');
    assert.equal(PeriodCalc.localTime(utc(1850, 6, 15, 10, 20, 11), 'Europe/Helsinki').offset, 5989);
    // instance methods default to the spec zone
    const pc = new PeriodCalc({ epoch: '2026-01-01', length: 'day', timeZone: 'Europe/Helsinki' });
    assert.equal(pc.localTime(t).timeStr, '04:30:00');
    assert.equal(pc.localTime(t, 'UTC').timeStr, '01:30:00');
    assert.equal(pc.parseDateTime('2026-03-29 04:30'), t);
    assert.equal(pc.parseDateTime('2026-03-29 01:30', 'UTC'), t);
    // gap and overlap
    assert.equal(PeriodCalc.parseDateTime('2026-03-29 03:30', 'Europe/Helsinki'), t);
    assert.equal(PeriodCalc.parseDateTime('2026-03-29T03:00:00', 'Europe/Helsinki'), utc(2026, 3, 29, 1));
    assert.equal(PeriodCalc.parseDateTime('2026-10-25 03:30', 'Europe/Helsinki'), utc(2026, 10, 25, 0, 30));
    assert.equal(PeriodCalc.parseDateTime('2026-10-25 04:00', 'Europe/Helsinki'), utc(2026, 10, 25, 2));
    assert.equal(PeriodCalc.parseDateTime('2026-01-01'), utc(2026, 1, 1));
    assert.equal(PeriodCalc.parseDateTime('2026-01-01 12:34'), utc(2026, 1, 1, 12, 34));
    assert.equal(PeriodCalc.parseDateTime('1000-01-01'), PeriodCalc.MIN_TIME);
    assert.equal(PeriodCalc.parseDateTime('9999-12-31 23:59:59'), PeriodCalc.MAX_TIME);
    for (const bad of [ '2026-1-1', '2026-01-01 12', '2026-01-01 12:34:56.7', '2026-02-29', '2026-01-01T25:00',
                        '2026-01-01T12:60', '2026-01-01T12:00:60', '9999-12-31 23:59:59+', 42, null, undefined ]) {
        assert.throws(() => PeriodCalc.parseDateTime(bad), /Invalid datetime/, JSON.stringify(bad));
    }
    assert.throws(() => PeriodCalc.parseDateTime('1000-01-01', 'Europe/Helsinki'), /Invalid datetime/);
    assert.throws(() => PeriodCalc.parseDateTime('2026-01-01', 'Nope/Nope'), /Invalid time zone/);
});

test('invalid times and indexes', function() {
    const pc = new PeriodCalc({ epoch: 0, length: 3600 });
    for (const bad of [ 'now', '1788964903', NaN, Infinity, -Infinity, Date.now(), {}, [], true,
                        PeriodCalc.MAX_TIME + 1, PeriodCalc.MIN_TIME - 1, new Date(NaN), new Date(8.64e15) ]) {
        assert.throws(() => pc.byTime(bad), /Invalid time/, JSON.stringify(bad));
        assert.throws(() => PeriodCalc.localTime(bad), /Invalid time/, JSON.stringify(bad));
    }
    for (const bad of [ 1.5, '1', NaN, Infinity, null, undefined, 2 ** 53, -(2 ** 53) ]) {
        assert.throws(() => pc.byIndex(bad), /Invalid index/, JSON.stringify(bad));
    }
    // the last periods of the range exist, beyond that nothing does
    assert.equal(pc.byIndex(70389527).last, PeriodCalc.MAX_TIME);
    assert.equal(pc.byTime(PeriodCalc.MAX_TIME).index, 70389527);
    assert.throws(() => pc.byIndex(70389528), /Invalid index/);
    assert.equal(pc.byIndex(-8502840).first, PeriodCalc.MIN_TIME);
    assert.equal(pc.byTime(PeriodCalc.MIN_TIME).index, -8502840);
    assert.throws(() => pc.byIndex(-8502841), /Invalid index/);
    assert.throws(() => pc.byIndex(1e15), /Invalid index/);
    const cal = new PeriodCalc({ epoch: '2026-01-01', length: 'year', timeZone: 'Europe/Helsinki' });
    assert.equal(PeriodCalc.localTime(cal.byIndex(7973).first, 'Europe/Helsinki').dateTimeStr, '9999-01-01T00:00:00');
    assert.equal(cal.byIndex(7973).last, PeriodCalc.parseDateTime('9999-12-31 21:59:59'));
    assert.equal(cal.byTime(cal.byIndex(7973).last).index, 7973);
    // the period that would contain the last supported second has no end
    assert.throws(() => cal.byIndex(7974), /Invalid index/);
    assert.throws(() => cal.byTime(PeriodCalc.MAX_TIME), /Invalid time/);
    assert.equal(PeriodCalc.localTime(cal.byIndex(-1025).first, 'Europe/Helsinki').dateTimeStr, '1001-01-01T00:00:00');
    assert.throws(() => cal.byIndex(-1026), /Invalid index/);
    assert.throws(() => cal.byIndex(1e15), /Invalid index/);
    assert.throws(() => cal.byIndex(-1e15), /Invalid index/);
    const days = new PeriodCalc({ epoch: '2026-01-01', length: '1000000day' });
    assert.throws(() => days.byIndex(3), /Invalid index/);
    assert.throws(() => days.byIndex(1e12), /Invalid index/);
});

// ---- compatibility with the legacy implementation ----

test('indexes and boundaries agree with periodCalculator.js', async function() {
    const legacy = await import(pathToFileURL(path.join(__dirname, 'reference', 'periodCalculator.mjs')).href);
    const specs = [ { periodEpoch: 1788964903, periodLength: 600 },
                    { periodEpoch: -365 * 86400, periodLength: 7 * 3600 },
                    { calendarEpoch: '2026-01-01', calendarPeriodLength: 'day', timeZone: 'Europe/Helsinki' },
                    { calendarEpoch: '2026-01-05 08:00', calendarPeriodLength: 'week', timeZone: 'America/New_York' },
                    { calendarEpoch: '2024-02-15 03:30:00', calendarPeriodLength: 'day', timeZone: 'Europe/Helsinki' },
                    { calendarEpoch: '2020-06-01 12:00', calendarPeriodLength: 'month', timeZone: 'Australia/Lord_Howe' },
                    { calendarEpoch: '2000-01-01', calendarPeriodLength: 'year', timeZone: 'Pacific/Auckland' },
                    { calendarEpoch: '2015-03-28 02:15', calendarPeriodLength: 'week', timeZone: 'Asia/Calcutta' },
                    { calendarEpoch: '2026-01-01', calendarPeriodLength: 'month' },
                    { calendarEpoch: '1999-12-31 23:59:59', calendarPeriodLength: 'day', timeZone: 'UTC' } ];
    // days with DST transitions in the zones above (UTC dates), swept
    // around at 15 minute steps, plus a spread of ordinary times
    const days = [ utc(2026, 3, 29), utc(2026, 10, 25), utc(2026, 3, 8), utc(2026, 11, 1),
                   utc(2026, 4, 5), utc(2026, 10, 4), utc(2026, 9, 27), utc(2024, 3, 31), utc(2024, 10, 27) ];
    let seed = 12345;
    function rnd() {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    }
    let compared = 0, legacyInconsistent = 0;
    for (const spec of specs) {
        const pc = new PeriodCalc(spec);
        const times = [];
        for (const day of days) {
            for (let t = day - 43200; t <= day + 43200; t += 1800) {
                times.push(t);
            }
        }
        const around = legacy.periodByIndex(spec, 0).first;
        for (let i = 0; i < 200; i++) {
            times.push(around + Math.floor((rnd() - 0.5) * 6 * 365 * 86400));
        }
        for (const t of times) {
            const ref = legacy.periodByUnixTime(spec, t);
            const p = pc.byTime(t);
            assert.ok((p.first <= t) && (t <= p.last));
            if ((ref.first <= t) && (t <= ref.last)) {
                assert.deepEqual([ p.index, p.first, p.last ], [ ref.index, ref.first, ref.last ],
                                 JSON.stringify(spec) + ' at ' + iso(t));
                compared++;
            } else {
                // the legacy code contradicts its own boundaries here (epoch
                // time-of-day inside a DST transition); ours must not
                legacyInconsistent++;
            }
        }
        for (let k = -40; k <= 40; k++) {
            const ref = legacy.periodByIndex(spec, k);
            const p = pc.byIndex(k);
            assert.deepEqual([ p.index, p.first, p.last ], [ ref.index, ref.first, ref.last ], JSON.stringify(spec) + ' #' + k);
        }
        assert.deepEqual(new PeriodCalc(legacy.periodByIndex(spec, 3).spec).spec, pc.spec);
    }
    assert.ok(compared > 4000, 'compared ' + compared);
    assert.ok(legacyInconsistent > 0, 'the legacy DST edge case was exercised');
    assert.ok(legacyInconsistent < 20, 'legacy inconsistencies ' + legacyInconsistent);
});
