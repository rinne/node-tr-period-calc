'use strict';

const tzList = new Map(Intl.supportedValuesOf('timeZone').map((tz) => [ tz.toLowerCase().replace(/[_-]+/g, ' '), tz ]));

function timeZoneNormalize(timeZone) {
    if ([ 'UTC', null, undefined ].includes(timeZone)) {
        return 'UTC';
    }
    if (! (typeof(timeZone) === 'string')) {
        return undefined;
    }
    const r = tzList.get(timeZone.toLowerCase().replace(/[_-]+/g, ' '));
    return r ?? undefined;
}

function legalDate(Y, M, D) {
    if (! (Number.isSafeInteger(Y) && (Y >= 1000) && (Y <= 9999))) {
        return false;
    }
    const md = [ 31, ((((Y % 4) == 0) && ((Y % 100) != 0)) || ((Y % 400) == 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];
    return (Number.isSafeInteger(M) && (M >= 1) && (M <= 12) && Number.isSafeInteger(D) && (D >= 1) && (D <= md[M - 1]));
}

function legalTime(h, m, s) {
    return (Number.isSafeInteger(h) && (h >= 0) && (h <= 23) && Number.isSafeInteger(m) && (m >= 0) && (m <= 59) && Number.isSafeInteger(s) && (s >= 0) && (s <= 59));
}

function legalDateTime(Y, M, D, h, m, s) {
    return (legalDate(Y, M, D) && legalTime(h, m, s));
}

function dateStr(Y, M, D) {
    if (! legalDate(Y, M, D)) {
        throw new Error('Bad date');
    }
    return (Y.toString().padStart(4, 0) + '-' + M.toString().padStart(2, 0) + '-' + D.toString().padStart(2, 0));
}

function timeStr(h, m, s) {
    if (! legalTime(h, m, s)) {
        throw new Error('Bad time');
    }
    return ((h ?? 0).toString().padStart(2, 0) + ':' + (m ?? 0).toString().padStart(2, 0) + ':' + (s ?? 0).toString().padStart(2, 0));
}

function dateTimeStr(Y, M, D, h = 0, m = 0, s = 0) {
    return (dateStr(Y, M, D) + ' ' + timeStr(h, m, s));
}

function fillParsed(r) {
    r.time = Math.floor(r.javascript / 1000);
    r.local.yearIndex = r.local.year - 1970;
    r.local.monthIndex = (r.local.yearIndex * 12) + r.local.month - 1;
    r.local.dayIndex = Math.floor((new Date(r.local.year, r.local.month - 1, r.local.day, 12, 0, 0)).getTime() / 86400000);
    r.local.timeStr = timeStr(r.local.hour, r.local.minute, r.local.second);
    r.local.dateStr = dateStr(r.local.year, r.local.month, r.local.day);
    r.local.dateTimeStr = r.local.dateStr + ' ' + r.local.timeStr;
    r.utc.yearIndex = r.utc.year - 1970;
    r.utc.monthIndex = (r.utc.yearIndex * 12) + r.utc.month - 1;
    r.utc.dayIndex = Math.floor(r.time / 86400);
    r.utc.timeStr = timeStr(r.utc.hour, r.utc.minute, r.utc.second);
    r.utc.dateStr = dateStr(r.utc.year, r.utc.month, r.utc.day);
    r.utc.dateTimeStr = r.utc.dateStr + ' ' + r.utc.timeStr;
    return r;
}

function unixTimeParse(ts, timeZone) {
    timeZone = timeZoneNormalize(timeZone);
    if (! (Number.isSafeInteger(ts) && (ts >= -30610224000) && (ts <= 253402300799) && timeZone)) {
        throw new Error('Invalid time');
    }
    let r, tzs;
    try {
        tzs = process.env.TZ;
        process.env.TZ = (timeZone === 'UTC' ? undefined : timeZone);
        const dr = new Date(ts * 1000);
        r = { local: { year: dr.getFullYear(),
                       month: dr.getMonth() + 1,
                       day: dr.getDate(),
                       hour: dr.getHours(),
                       minute: dr.getMinutes(),
                       second: dr.getSeconds(),
                       weekday: dr.getDay(),
                       timeZone: timeZone },
              utc: { year: dr.getUTCFullYear(),
                     month: dr.getUTCMonth() + 1,
                     day: dr.getUTCDate(),
                     hour: dr.getUTCHours(),
                     minute: dr.getUTCMinutes(),
                     second: dr.getUTCSeconds(),
                     weekday: dr.getUTCDay(),
                     timeZone: 'UTC' },
              javascript: dr.getTime() };
        if (! ((r.utc.year >= 1000) && (r.utc.year <= 9999) && (r.local.year >= 1000) && (r.local.year <= 9999))) {
            throw new Error('Bad timestamp');
        }
        fillParsed(r);
    } catch (_) {
        r = undefined;
    } finally {
        process.env.TZ = tzs;
    }
    if (! r) {
        throw new Error('Invalid time');
    }
    return r;
}


function dateTimeParse(dateTime, timeZone) {
    timeZone = timeZoneNormalize(timeZone);
    if (! ((typeof(dateTime) === 'string') && timeZone)) {
        throw new Error('Invalid time zone');
    }
    const mt = dateTime.match(/^(\d\d\d\d)-(\d\d)-(\d\d)((\s|T)(\d\d):(\d\d)(:(\d\d))?)?$/);
    if (! mt) {
        throw new Error('Invalid datetime');
    }
    const Y = Number.parseInt(mt[1]);
    const M = Number.parseInt(mt[2]);
    const D = Number.parseInt(mt[3]);
    const h = Number.parseInt(mt[6] ?? '00');
    const m = Number.parseInt(mt[7] ?? '00');
    const s = Number.parseInt(mt[9] ?? '00');

    if (! (legalDateTime(Y, M, D, h, m, s))) {
        throw new Error('Invalid datetime');
    }
    let dr, tzs;
    try {
        tzs = process.env.TZ;
        process.env.TZ = (timeZone === 'UTC' ? undefined : timeZone);
        dr = new Date(Y, M-1, D, h, m, s);
    } catch (_) {
        dr = undefined;
    } finally {
        process.env.TZ = tzs;
    }
    if (! dr) {
        throw new Error('Internal error');
    }
    let r = { local: { year: Y,
                       month: M,
                       day: D,
                       hour: h,
                       minute: m,
                       second: s,
                       weekday: dr.getDay(),
                       timeZone: timeZone },
              utc: { year: dr.getUTCFullYear(),
                     month: dr.getUTCMonth() + 1,
                     day: dr.getUTCDate(),
                     hour: dr.getUTCHours(),
                     minute: dr.getUTCMinutes(),
                     second: dr.getUTCSeconds(),
                     weekday: dr.getUTCDay(),
                     timeZone: 'UTC' },
              javascript: dr.getTime() };
    if (! (legalDate(r.utc.year, r.utc.month, (r.utc.day)))) {
        throw new Error('Invalid datetime');
    }
    fillParsed(r);
    return r;
}

function periodByDateTime(spec, dateTime, timeZone) {
    let parsedTime = dateTimeParse(dateTime, timeZone);
    return periodByUnixTime(spec, parsedTime.time);
}


function periodByUnixTime(spec, time) {
    if ([null, undefined].includes(time)) {
        time = Math.floor(Date.now() / 1000);
    }
    if (! Number.isSafeInteger(time)) {
        throw new Error('Invalid time');
    }
    let p = {};
    if (Number.isSafeInteger(spec?.periodEpoch) && Number.isSafeInteger(spec?.periodLength)) {
        p.time = time;
        p.index = Math.floor((time - spec.periodEpoch) / spec.periodLength);
        p.first = (p.index * spec.periodLength) + spec.periodEpoch;
        p.last = p.first + spec.periodLength - 1;
        p.spec = { periodEpoch: spec.periodEpoch, periodLength: spec.periodLength };
    } else if ((typeof(spec?.calendarEpoch) === 'string') &&
               [ 'day', 'week', 'month', 'year' ].includes(spec?.calendarPeriodLength)) {
        const timeParsed = unixTimeParse(time, spec.timeZone);
        const epochParsed = dateTimeParse(spec.calendarEpoch, spec.timeZone);
        p.time = time;
        switch (spec.calendarPeriodLength) {
        case 'day':
            {
                const adjust = (timeParsed.local.timeStr < epochParsed.local.timeStr) ? -1 : 0;
                p.index = timeParsed.local.dayIndex - epochParsed.local.dayIndex + adjust;
                let Y, M, D, h, m, s;
                Y = timeParsed.local.year;
                M = timeParsed.local.month;
                D = timeParsed.local.day + adjust;
                h = epochParsed.local.hour;
                m = epochParsed.local.minute;
                s = epochParsed.local.second;
                let tzs;
                try {
                    tzs = process.env.TZ;
                    process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                    p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                    D += 1;
                    s -= 1;
                    p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                } catch (_) {
                    p = undefined;
                } finally {
                    process.env.TZ = tzs;
                }
                if (! p) {
                    throw new Error('Internal error');
                }
            }
            break;
        case 'week':
            {
                const adjust = (timeParsed.local.timeStr < epochParsed.local.timeStr) ? -1 : 0;
                const dayIndex = p.index = timeParsed.local.dayIndex - epochParsed.local.dayIndex + adjust;
                p.index = Math.floor(dayIndex / 7);
                let wod = dayIndex % 7;
                if (wod < 0) {
                    wod += 7;
                }
                let Y, M, D, h, m, s;
                Y = timeParsed.local.year;
                M = timeParsed.local.month;
                D = timeParsed.local.day + adjust - wod;
                h = epochParsed.local.hour;
                m = epochParsed.local.minute;
                s = epochParsed.local.second;
                let tzs;
                try {
                    tzs = process.env.TZ;
                    process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                    p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                    D += 7;
                    s -= 1;
                    p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                } catch (_) {
                    p = undefined;
                } finally {
                    process.env.TZ = tzs;
                }
                if (! p) {
                    throw new Error('Internal error');
                }
            }
            break;
        case 'month':
            {
                const adjust = ((timeParsed.local.dateTimeStr.slice(8) < epochParsed.local.dateTimeStr.slice(8)) ? -1 : 0);
                p.index = timeParsed.local.monthIndex - epochParsed.local.monthIndex + adjust;
                let Y, M, D, h, m, s;
                Y = timeParsed.local.year;
                M = timeParsed.local.month + adjust;
                D = epochParsed.local.day;
                h = epochParsed.local.hour;
                m = epochParsed.local.minute;
                s = epochParsed.local.second;
                let tzs;
                try {
                    tzs = process.env.TZ;
                    process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                    p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                    M += 1;
                    s -= 1;
                    p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                } catch (_) {
                    p = undefined;
                } finally {
                    process.env.TZ = tzs;
                }
                if (! p) {
                    throw new Error('Internal error');
                }
            }
            break;
        case 'year':
            {
                const adjust = ((timeParsed.local.dateTimeStr.slice(5) < epochParsed.local.dateTimeStr.slice(5)) ? -1 : 0);
                p.index = timeParsed.local.yearIndex - epochParsed.local.yearIndex + adjust;
                let Y, M, D, h, m, s;
                Y = timeParsed.local.year + adjust;
                M = epochParsed.local.month;
                D = epochParsed.local.day;
                h = epochParsed.local.hour;
                m = epochParsed.local.minute;
                s = epochParsed.local.second;
                let tzs;
                try {
                    tzs = process.env.TZ;
                    process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                    p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                    Y += 1;
                    s -= 1;
                    p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                } catch (_) {
                    p = undefined;
                } finally {
                    process.env.TZ = tzs;
                }
                if (! p) {
                    throw new Error('Internal error');
                }
            }
            break;
        }
        p.spec = { calendarEpoch: spec.calendarEpoch, calendarPeriodLength: spec.calendarPeriodLength };
        if (epochParsed.local.timeZone !== 'UTC') {
            p.spec.timeZone = epochParsed.local.timeZone;
        }
    } else {
        throw new Error('Invalid spec');
    }
    return p;
}

function periodByIndex(spec, index) {
    if (! Number.isSafeInteger(index)) {
        throw new Error('Invalid index');
    }
    let p = { index };
    if (Number.isSafeInteger(spec?.periodEpoch) && Number.isSafeInteger(spec?.periodLength)) {
        p.first = (p.index * spec.periodLength) + spec.periodEpoch;
        p.last = p.first + spec.periodLength - 1;
        p.spec = { periodEpoch: spec.periodEpoch, periodLength: spec.periodLength };
    } else if ((typeof(spec?.calendarEpoch) === 'string') &&
               [ 'day', 'week', 'month', 'year' ].includes(spec?.calendarPeriodLength)) {
        const epochParsed = dateTimeParse(spec.calendarEpoch, spec.timeZone);
        let Y = epochParsed.local.year;
        let M = epochParsed.local.month;
        let D = epochParsed.local.day;
        let h = epochParsed.local.hour;
        let m = epochParsed.local.minute;
        let s = epochParsed.local.second;
        let tzs;
        switch (spec.calendarPeriodLength) {
        case 'day':
            try {
                tzs = process.env.TZ;
                process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                D += index;
                p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                D += 1;
                s -= 1;
                p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
            } catch (_) {
                p = undefined;
            } finally {
                process.env.TZ = tzs;
            }
            break;
        case 'week':
            try {
                tzs = process.env.TZ;
                process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                D += index * 7;
                p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                D += 7;
                s -= 1;
                p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
            } catch (_) {
                p = undefined;
            } finally {
                process.env.TZ = tzs;
            }
            break;
        case 'month':
            try {
                tzs = process.env.TZ;
                process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                M += index;
                p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                M += 1;
                s -= 1;
                p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
            } catch (_) {
                p = undefined;
            } finally {
                process.env.TZ = tzs;
            }
            break;
        case 'year':
            try {
                tzs = process.env.TZ;
                process.env.TZ = (epochParsed.local.timeZone === 'UTC' ? undefined : epochParsed.local.timeZone);
                Y += index;
                p.first = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
                Y += 1;
                s -= 1;
                p.last = Math.floor(new Date(Y, M-1, D, h, m, s).getTime() / 1000);
            } catch (_) {
                p = undefined;
            } finally {
                process.env.TZ = tzs;
            }
            break;
        }
        if (! p) {
            throw new Error('Internal error');
        }
        p.spec = { calendarEpoch: spec.calendarEpoch, calendarPeriodLength: spec.calendarPeriodLength };
        if (epochParsed.local.timeZone !== 'UTC') {
            p.spec.timeZone = epochParsed.local.timeZone;
        }
    } else {
        throw new Error('Invalid spec');
    }
    return p;
}

export { periodByIndex, periodByUnixTime, periodByDateTime,
         dateTimeParse, unixTimeParse,
         legalDate, legalTime, legalDateTime,
         dateStr, timeStr, dateTimeStr };
