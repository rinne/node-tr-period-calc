'use strict';

// Nord Pool market periods as tr-period-calc specs: a demonstration.
//
// The first hourly spot price of what became Nord Pool was set in Norway
// for the hour 1993-01-01 00:00–01:00 CET. That hour is the epoch here.
// Market days are calendar days in CET/CEST for every country in the
// system whatever its own zone: Finland and the Baltics trade 01:00–01:00
// EET/EEST, Ireland 23:00–23:00 GMT/IST, Portugal 23:00–23:00 WET/WEST.
// (The UK keeps its own market clock and is left out.)
//
// Market hours and quarters are counted straight from the epoch in unix
// time, so they do not divide market days evenly: the day DST starts has
// 23 hours and the day it ends has 25. Which hours make up a day is
// therefore a question of time, not of division, and that is what the
// helpers below answer.
//
// In a real project `require('..')` is `require('tr-period-calc')`.

const PeriodCalc = require('..');

// 'CET' is the IANA zone of the market definition itself. Intl accepts it
// as a link to Europe/Brussels; from 1993 on it is identical to every
// continental zone in the list below.
const MARKET_TIME_ZONE = 'CET';
const EPOCH_MARKET_TIME = '1993-01-01T00:00:00';
const EPOCH = PeriodCalc.parseDateTime(EPOCH_MARKET_TIME, MARKET_TIME_ZONE);

const marketDay = new PeriodCalc({ epoch: EPOCH_MARKET_TIME, length: 'day', timeZone: MARKET_TIME_ZONE });
const marketHour = new PeriodCalc({ epoch: EPOCH, length: 3600 });
const marketQuarter = new PeriodCalc({ epoch: EPOCH, length: 900 });

const KINDS = [ 'day', 'hour', 'quarter' ];
const calcs = { day: marketDay, hour: marketHour, quarter: marketQuarter };

const countries = [
    { name: 'Germany', timeZone: 'Europe/Berlin' },
    { name: 'France', timeZone: 'Europe/Paris' },
    { name: 'Norway', timeZone: 'Europe/Oslo' },
    { name: 'Sweden', timeZone: 'Europe/Stockholm' },
    { name: 'Denmark', timeZone: 'Europe/Copenhagen' },
    { name: 'Netherlands', timeZone: 'Europe/Amsterdam' },
    { name: 'Belgium', timeZone: 'Europe/Brussels' },
    { name: 'Austria', timeZone: 'Europe/Vienna' },
    { name: 'Luxembourg', timeZone: 'Europe/Luxembourg' },
    { name: 'Poland', timeZone: 'Europe/Warsaw' },
    { name: 'Finland', timeZone: 'Europe/Helsinki' },
    { name: 'Estonia', timeZone: 'Europe/Tallinn' },
    { name: 'Latvia', timeZone: 'Europe/Riga' },
    { name: 'Lithuania', timeZone: 'Europe/Vilnius' },
    { name: 'Ireland', timeZone: 'Europe/Dublin' },
    { name: 'Portugal', timeZone: 'Europe/Lisbon' }
];

function calc(kind) {
    const c = calcs[kind];
    if (! c) {
        throw new Error('Invalid kind');
    }
    return c;
}

// The market day, hour and quarter containing a time (as for byTime).
function at(time) {
    const hour = marketHour.byTime(time);
    return { time: PeriodCalc.localTime(time).time,
             day: marketDay.byTime(time),
             hour,
             quarter: marketQuarter.byTime(time) };
}

// The periods of `kind` inside period `p`: the index of the one holding
// its first second, the one holding its last, and how many that is.
function within(kind, p) {
    const c = calc(kind);
    const first = c.byTime(p.first).index;
    const last = c.byTime(p.last).index;
    return { first, last, count: last - first + 1 };
}

// A period's first and last second on each country's clock.
function countryClocks(p) {
    return countries.map((c) => ({ name: c.name,
                                   timeZone: c.timeZone,
                                   first: PeriodCalc.localTime(p.first, c.timeZone).dateTimeStr,
                                   last: PeriodCalc.localTime(p.last, c.timeZone).dateTimeStr }));
}

// A period with the larger period it belongs to and the smaller ones it
// is made of. Membership is by time: the day of an hour is the day
// holding the hour's first second.
function describe(kind, index) {
    const period = calc(kind).byIndex(index);
    const r = { kind, period };
    switch (kind) {
    case 'day':
        r.hours = within('hour', period);
        r.quarters = within('quarter', period);
        break;
    case 'hour':
        r.day = marketDay.byTime(period.first);
        r.quarters = within('quarter', period);
        break;
    case 'quarter':
        r.day = marketDay.byTime(period.first);
        r.hour = marketHour.byTime(period.first);
        break;
    }
    r.countries = countryClocks(period);
    return r;
}

module.exports = { MARKET_TIME_ZONE, EPOCH_MARKET_TIME, EPOCH, KINDS,
                   marketDay, marketHour, marketQuarter, calc, countries,
                   at, within, countryClocks, describe };
