'use strict';

// tr-period-calc — canonical sequential period indexing.
//
// A period spec is one of two kinds:
//
//   fixed:    epoch (unix seconds) and length (seconds). Pure unix-time
//             arithmetic; index = floor((t - epoch) / length). Boundaries
//             never drift: 15-minute periods anchored at 12:00:00Z stay at
//             *:00, *:15, *:30, *:45 UTC forever.
//   calendar: epoch (local date-time), length (N × day|week|month|year)
//             and an IANA time zone. Boundaries follow the local clock
//             through DST changes and varying month lengths, so a
//             "week starting Monday 08:00 in New York" is exactly that.
//
// Periods are contiguous and non-overlapping in whole unix seconds:
// period k is [first(k), first(k + 1) - 1]. Only periods lying entirely
// inside the supported range exist; every instant covered by them belongs
// to exactly one. A calendar period whose whole local span is skipped by
// the clock (Pacific/Apia lost 2011-12-30) is empty: last = first - 1.
// Period 0 starts at the epoch, negative indexes precede it.
//
// URI form, for a spec alone or for one self-contained period:
//
//   tr-period-calc://?epoch=1788964903&length=600
//   tr-period-calc://1231?epoch=1788964903&length=600
//   tr-period-calc://?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York
//
// Local wall-clock times map to instants the way legacy Date (and
// Temporal's 'compatible' disambiguation) do: a time inside a DST gap is
// pushed forward by the size of the gap, a repeated time resolves to its
// first occurrence. Month-day overflow is constrained: monthly periods
// from the 31st start on the last day of shorter months, yearly periods
// from Feb 29 start on Feb 28 in common years.

const SCHEME = 'tr-period-calc';

// Supported instants: 1000-01-01T00:00:00Z .. 9999-12-31T23:59:59Z.
const MIN_TIME = -30610224000;
const MAX_TIME = 253402300799;

const DAY = 86400;

// Calendar units are stepped either in days or in months.
const calendarUnits = {
    day: { days: 1 },
    week: { days: 7 },
    month: { months: 1 },
    year: { months: 12 }
};

// Accepted spec object forms: the current one and the two legacy forms
// of periodCalculator.js, mapped onto { epoch, length, timeZone }.
const specForms = [
    { epoch: 'epoch', length: 'length', timeZone: 'timeZone' },
    { epoch: 'periodEpoch', length: 'periodLength', timeZone: 'timeZone' },
    { epoch: 'calendarEpoch', length: 'calendarPeriodLength', timeZone: 'timeZone' }
];

const uriParams = new Map([ [ 'epoch', 'epoch' ], [ 'length', 'length' ], [ 'tz', 'timeZone' ] ]);

const uriRe = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)\/?\?([^#]*)$/;
const integerRe = /^(?:0|-?[1-9]\d*)$/;
const dateTimeRe = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const calendarLengthRe = /^([1-9]\d*)?(day|week|month|year)$/;

// ---- time zones ----

// Case-folded IANA names known to Intl, mapped to their listed spelling.
// Underscores, dashes and spaces are folded so that 'america/new york'
// finds America/New_York.
const tzListed = new Map();
for (const tz of Intl.supportedValuesOf('timeZone')) {
    tzListed.set(tzFold(tz), tz);
}

const tzFormatters = new Map();

function tzFold(s) {
    return s.toLowerCase().replace(/[_\s-]+/g, ' ');
}

// Returns the canonical name or undefined. Names on the Intl list get
// their listed spelling; other names Intl accepts (links such as
// US/Eastern, or spellings newer than the local ICU) are kept as given,
// so the spec never depends on which alias the local ICU prefers.
function timeZoneNormalize(timeZone) {
    if ((timeZone === undefined) || (timeZone === null)) {
        return 'UTC';
    }
    if (! (typeof(timeZone) === 'string')) {
        return undefined;
    }
    if (timeZone.toUpperCase() === 'UTC') {
        return 'UTC';
    }
    const listed = tzListed.get(tzFold(timeZone));
    if (listed) {
        return listed;
    }
    let resolved;
    try {
        resolved = new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
    } catch (_) {
        return undefined;
    }
    return ((resolved === 'UTC') ? 'UTC' : timeZone);
}

function tzFormatter(timeZone) {
    let f = tzFormatters.get(timeZone);
    if (! f) {
        f = new Intl.DateTimeFormat('en-US', { timeZone,
                                               hourCycle: 'h23',
                                               year: 'numeric',
                                               month: 'numeric',
                                               day: 'numeric',
                                               hour: 'numeric',
                                               minute: 'numeric',
                                               second: 'numeric' });
        tzFormatters.set(timeZone, f);
    }
    return f;
}

// ---- dates ----

function isLeapYear(y) {
    return ((((y % 4) === 0) && ((y % 100) !== 0)) || ((y % 400) === 0));
}

function daysInMonth(y, m) {
    return [ 31, (isLeapYear(y) ? 29 : 28), 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ][m - 1];
}

function legalDate(y, m, d) {
    return (Number.isSafeInteger(y) && (y >= 1000) && (y <= 9999) &&
            Number.isSafeInteger(m) && (m >= 1) && (m <= 12) &&
            Number.isSafeInteger(d) && (d >= 1) && (d <= daysInMonth(y, m)));
}

function legalTime(h, m, s) {
    return (Number.isSafeInteger(h) && (h >= 0) && (h <= 23) &&
            Number.isSafeInteger(m) && (m >= 0) && (m <= 59) &&
            Number.isSafeInteger(s) && (s >= 0) && (s <= 59));
}

function pad(n, w) {
    return n.toString().padStart(w, '0');
}

function dateStr(f) {
    return (pad(f.year, 4) + '-' + pad(f.month, 2) + '-' + pad(f.day, 2));
}

function timeStr(f) {
    return (pad(f.hour, 2) + ':' + pad(f.minute, 2) + ':' + pad(f.second, 2));
}

function dateTimeStr(f) {
    return (dateStr(f) + 'T' + timeStr(f));
}

// 'YYYY-MM-DD', 'YYYY-MM-DD HH:MM', 'YYYY-MM-DDTHH:MM:SS' (space or T)
// to wall-clock fields, or undefined.
function dateTimeFields(s) {
    if (! (typeof(s) === 'string')) {
        return undefined;
    }
    const m = s.match(dateTimeRe);
    if (! m) {
        return undefined;
    }
    const f = { year: Number(m[1]),
                month: Number(m[2]),
                day: Number(m[3]),
                hour: Number(m[4] ?? '0'),
                minute: Number(m[5] ?? '0'),
                second: Number(m[6] ?? '0') };
    return ((legalDate(f.year, f.month, f.day) && legalTime(f.hour, f.minute, f.second)) ? f : undefined);
}

// Wall-clock fields as if they were UTC, in ms. Years below 100 must
// never reach here (Date.UTC would remap them).
function wallMs(f) {
    return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
}

function inRange(t) {
    return (Number.isSafeInteger(t) && (t >= MIN_TIME) && (t <= MAX_TIME));
}

// ---- instant <-> local wall clock ----

// Local wall-clock fields of an instant (unix seconds) in a zone, with
// weekday (0 = Sunday) and the zone offset in seconds east of UTC.
function localFields(time, timeZone) {
    if (timeZone === 'UTC') {
        const d = new Date(time * 1000);
        return { year: d.getUTCFullYear(),
                 month: d.getUTCMonth() + 1,
                 day: d.getUTCDate(),
                 hour: d.getUTCHours(),
                 minute: d.getUTCMinutes(),
                 second: d.getUTCSeconds(),
                 weekday: d.getUTCDay(),
                 offset: 0 };
    }
    const v = {};
    for (const p of tzFormatter(timeZone).formatToParts(new Date(time * 1000))) {
        v[p.type] = p.value;
    }
    const f = { year: Number(v.year),
                month: Number(v.month),
                day: Number(v.day),
                hour: Number(v.hour) % 24,
                minute: Number(v.minute),
                second: Number(v.second) };
    const wall = wallMs(f);
    f.weekday = new Date(wall).getUTCDay();
    f.offset = Math.round(wall / 1000) - time;
    return f;
}

// Wall-clock (ms, as if UTC) in a zone to the instant in unix seconds.
// Candidates are formed with the offsets in force a day before and a day
// after; the one that maps back to the wall time wins, the earlier one
// first (a repeated hour resolves to its first occurrence). A wall time
// that maps back with neither is inside a gap: the offset from before
// the transition is applied, pushing the time forward by the gap.
function wallToTime(wall, timeZone) {
    const w = wall / 1000;
    if (timeZone === 'UTC') {
        return w;
    }
    const before = localFields(w - DAY, timeZone).offset;
    const after = localFields(w + DAY, timeZone).offset;
    if (localFields(w - before, timeZone).offset === before) {
        return (w - before);
    }
    if (localFields(w - after, timeZone).offset === after) {
        return (w - after);
    }
    return (w - before);
}

// ---- input parsing ----

// A time argument: unix seconds (number, fractions floored), a Date, or
// nullish for now. Returns unix seconds or undefined.
function timeParse(time) {
    let t;
    if ((time === undefined) || (time === null)) {
        t = Math.floor(Date.now() / 1000);
    } else if (time instanceof Date) {
        t = Math.floor(time.getTime() / 1000);
    } else if (typeof(time) === 'number') {
        t = Math.floor(time);
    }
    return (inRange(t) ? t : undefined);
}

// Epoch input: unix seconds as a number, a numeric string or a Date, or
// a local date-time string. Returns { time } or { fields }, or undefined.
function epochParse(epoch) {
    if (epoch instanceof Date) {
        const t = Math.floor(epoch.getTime() / 1000);
        return (Number.isSafeInteger(t) ? { time: t } : undefined);
    }
    if (typeof(epoch) === 'number') {
        return (Number.isSafeInteger(epoch) ? { time: epoch } : undefined);
    }
    if (typeof(epoch) === 'string') {
        if (integerRe.test(epoch)) {
            const t = Number(epoch);
            return (Number.isSafeInteger(t) ? { time: t } : undefined);
        }
        const fields = dateTimeFields(epoch);
        return (fields ? { fields } : undefined);
    }
    return undefined;
}

// Length input: seconds as a number or numeric string (fixed), or
// '[N]day|week|month|year' (calendar). Returns { seconds } or
// { unit, count }, or undefined.
function lengthParse(length) {
    if (typeof(length) === 'number') {
        return ((Number.isSafeInteger(length) && (length > 0)) ? { seconds: length } : undefined);
    }
    if (typeof(length) === 'string') {
        if (integerRe.test(length)) {
            const n = Number(length);
            return ((Number.isSafeInteger(n) && (n > 0)) ? { seconds: n } : undefined);
        }
        const m = length.match(calendarLengthRe);
        if (m) {
            const count = (m[1] === undefined) ? 1 : Number(m[1]);
            return (Number.isSafeInteger(count) ? { unit: m[2], count } : undefined);
        }
    }
    return undefined;
}

function isPlainObject(x) {
    return ((typeof(x) === 'object') && (x !== null) && ! Array.isArray(x));
}

// A spec object in any accepted form to { epoch, length, timeZone }.
// Keys with undefined values count as absent; other unknown keys are
// rejected rather than silently ignored.
function specFromObject(o) {
    const keys = Object.keys(o).filter((k) => (o[k] !== undefined));
    for (const form of specForms) {
        const known = Object.values(form);
        if (keys.every((k) => known.includes(k)) && keys.includes(form.epoch) && keys.includes(form.length)) {
            return { epoch: o[form.epoch], length: o[form.length], timeZone: o[form.timeZone] };
        }
    }
    throw new Error('Invalid spec');
}

// { epoch, length, timeZone } in input form to the internal normalized
// spec.
function specNormalize(input) {
    const timeZone = timeZoneNormalize(input.timeZone);
    if (! timeZone) {
        throw new Error('Invalid time zone');
    }
    const epoch = epochParse(input.epoch);
    const length = lengthParse(input.length);
    if (! (epoch && length)) {
        throw new Error('Invalid spec');
    }
    if (length.seconds) {
        let time;
        if (epoch.fields) {
            time = wallToTime(wallMs(epoch.fields), timeZone);
        } else {
            // A zone would have no effect on unix-time periods. Refuse it
            // instead of letting the caller believe otherwise.
            if (timeZone !== 'UTC') {
                throw new Error('Invalid spec');
            }
            time = epoch.time;
        }
        if (! inRange(time)) {
            throw new Error('Invalid spec');
        }
        return { type: 'fixed', epoch: time, length: length.seconds, timeZone: 'UTC' };
    }
    let fields;
    if (epoch.fields) {
        fields = epoch.fields;
    } else {
        if (! inRange(epoch.time)) {
            throw new Error('Invalid spec');
        }
        fields = localFields(epoch.time, timeZone);
        if (! legalDate(fields.year, fields.month, fields.day)) {
            throw new Error('Invalid spec');
        }
    }
    const step = calendarUnits[length.unit];
    return { type: 'calendar',
             epoch: dateTimeStr(fields),
             length: ((length.count === 1) ? '' : length.count.toString()) + length.unit,
             timeZone,
             fields: { year: fields.year,
                       month: fields.month,
                       day: fields.day,
                       hour: fields.hour,
                       minute: fields.minute,
                       second: fields.second },
             days: (step.days ?? 0) * length.count,
             months: (step.months ?? 0) * length.count };
}

// ---- URI ----

// One query component, percent-decoded. A '+' is a literal plus, not a
// space: this is an RFC 3986 query, not a form submission.
function uriDecode(s) {
    try {
        return decodeURIComponent(s);
    } catch (_) {
        throw new Error('Invalid URI');
    }
}

// Returns { index, spec } with index undefined when the URI carries none
// and spec in input form (strings).
function uriParse(uri) {
    const m = ((typeof(uri) === 'string') ? uri.match(uriRe) : null);
    if (! (m && (m[1].toLowerCase() === SCHEME))) {
        throw new Error('Invalid URI');
    }
    let index;
    if (m[2] !== '') {
        index = (integerRe.test(m[2]) ? Number(m[2]) : undefined);
        if (! Number.isSafeInteger(index)) {
            throw new Error('Invalid URI');
        }
    }
    const spec = {};
    for (const param of m[3].split('&')) {
        if (param === '') {
            continue;
        }
        const eq = param.indexOf('=');
        if (eq < 0) {
            throw new Error('Invalid URI');
        }
        const name = uriParams.get(uriDecode(param.slice(0, eq)));
        if (! (name && ! (name in spec))) {
            throw new Error('Invalid URI');
        }
        spec[name] = uriDecode(param.slice(eq + 1));
    }
    if (! (('epoch' in spec) && ('length' in spec))) {
        throw new Error('Invalid URI');
    }
    return { index, spec };
}

function uriBuild(spec, index) {
    let s = SCHEME + '://' + ((index === undefined) ? '' : index.toString()) +
        '?epoch=' + spec.epoch + '&length=' + spec.length;
    if (spec.timeZone !== 'UTC') {
        s += '&tz=' + encodeURIComponent(spec.timeZone).replace(/%2F/gi, '/');
    }
    return s;
}

// ---- the calculator ----

class PeriodCalc {

    #spec;
    #public;
    #uri;

    // spec: a spec URI (an index in it is ignored), a spec object in the
    // current or a legacy form, or another PeriodCalc.
    constructor(spec) {
        let input;
        if (spec instanceof PeriodCalc) {
            input = spec.spec;
        } else if (typeof(spec) === 'string') {
            input = uriParse(spec).spec;
        } else if (isPlainObject(spec)) {
            input = specFromObject(spec);
        } else {
            throw new Error('Invalid spec');
        }
        this.#spec = specNormalize(input);
        this.#public = Object.freeze({ epoch: this.#spec.epoch,
                                       length: this.#spec.length,
                                       timeZone: this.#spec.timeZone });
        this.#uri = uriBuild(this.#public);
    }

    get spec() {
        return this.#public;
    }

    get uri() {
        return this.#uri;
    }

    get type() {
        return this.#spec.type;
    }

    toString() {
        return this.#uri;
    }

    toJSON() {
        return this.#uri;
    }

    equals(other) {
        const o = ((other instanceof PeriodCalc) ? other : new PeriodCalc(other));
        return (o.uri === this.#uri);
    }

    byIndex(index) {
        if (! Number.isSafeInteger(index)) {
            throw new Error('Invalid index');
        }
        const first = this.#first(index);
        const next = this.#first(index + 1);
        if (! ((first !== undefined) && (first <= MAX_TIME) && (next !== undefined))) {
            throw new Error('Invalid index');
        }
        return this.#period(index, first, next - 1);
    }

    byTime(time) {
        const t = timeParse(time);
        if (t === undefined) {
            throw new Error('Invalid time');
        }
        let k = this.#estimate(t);
        let first = this.#first(k);
        let next = this.#first(k + 1);
        // The estimate is exact for fixed periods and within one of the
        // truth for calendar periods; make it agree with the boundaries.
        if ((first !== undefined) && (t < first)) {
            k -= 1;
            next = first;
            first = this.#first(k);
        } else if ((next !== undefined) && (t >= next)) {
            k += 1;
            first = next;
            next = this.#first(k + 1);
        }
        if (! ((first !== undefined) && (next !== undefined) && (t >= first) && (t < next))) {
            throw new Error('Invalid time');
        }
        return this.#period(k, first, next - 1);
    }

    byDateTime(dateTime, timeZone) {
        return this.byTime(PeriodCalc.parseDateTime(dateTime, timeZone ?? this.#spec.timeZone));
    }

    byUri(uri) {
        const { index, spec } = uriParse(uri);
        if (index === undefined) {
            throw new Error('Invalid URI');
        }
        if (! this.equals(spec)) {
            throw new Error('Spec mismatch');
        }
        return this.byIndex(index);
    }

    // All periods from the one containing `from` to the one containing
    // `to`, inclusive, in order.
    range(from, to) {
        const a = this.byTime(from);
        const b = this.byTime(to);
        if (b.index < a.index) {
            throw new Error('Invalid time');
        }
        const r = [];
        let first = a.first;
        for (let k = a.index; k <= b.index; k++) {
            const next = ((k === b.index) ? (b.last + 1) : this.#first(k + 1));
            r.push(this.#period(k, first, next - 1));
            first = next;
        }
        return r;
    }

    localTime(time, timeZone) {
        return PeriodCalc.localTime(time, timeZone ?? this.#spec.timeZone);
    }

    parseDateTime(dateTime, timeZone) {
        return PeriodCalc.parseDateTime(dateTime, timeZone ?? this.#spec.timeZone);
    }

    static parseUri(uri) {
        const { index, spec } = uriParse(uri);
        return { index, spec: new PeriodCalc(spec).spec };
    }

    static periodByUri(uri) {
        const { index, spec } = uriParse(uri);
        if (index === undefined) {
            throw new Error('Invalid URI');
        }
        return new PeriodCalc(spec).byIndex(index);
    }

    // Local wall-clock view of an instant. `time` as in byTime (nullish
    // for now), `timeZone` defaults to UTC.
    static localTime(time, timeZone) {
        const tz = timeZoneNormalize(timeZone);
        if (! tz) {
            throw new Error('Invalid time zone');
        }
        const t = timeParse(time);
        if (t === undefined) {
            throw new Error('Invalid time');
        }
        const f = localFields(t, tz);
        return { time: t,
                 timeZone: tz,
                 year: f.year,
                 month: f.month,
                 day: f.day,
                 hour: f.hour,
                 minute: f.minute,
                 second: f.second,
                 weekday: f.weekday,
                 offset: f.offset,
                 dateStr: dateStr(f),
                 timeStr: timeStr(f),
                 dateTimeStr: dateTimeStr(f) };
    }

    // 'YYYY-MM-DD[(T| )HH:MM[:SS]]' in a zone (default UTC) to unix seconds.
    static parseDateTime(dateTime, timeZone) {
        const tz = timeZoneNormalize(timeZone);
        if (! tz) {
            throw new Error('Invalid time zone');
        }
        const f = dateTimeFields(dateTime);
        if (! f) {
            throw new Error('Invalid datetime');
        }
        const t = wallToTime(wallMs(f), tz);
        if (! inRange(t)) {
            throw new Error('Invalid datetime');
        }
        return t;
    }

    static normalizeTimeZone(timeZone) {
        const tz = timeZoneNormalize(timeZone);
        if (! tz) {
            throw new Error('Invalid time zone');
        }
        return tz;
    }

    // Start of period `index` in unix seconds, or undefined when it falls
    // outside the supported range. One second past the range is allowed:
    // it is where the last period ends.
    #first(index) {
        const s = this.#spec;
        let t;
        if (s.type === 'fixed') {
            t = s.epoch + (index * s.length);
        } else {
            const e = s.fields;
            let wall;
            if (s.days) {
                wall = Date.UTC(e.year, e.month - 1, e.day + (index * s.days), e.hour, e.minute, e.second);
            } else {
                const months = (e.month - 1) + (index * s.months);
                const y = e.year + Math.floor(months / 12);
                const m = (((months % 12) + 12) % 12) + 1;
                if (! ((y >= 999) && (y <= 10000))) {
                    return undefined;
                }
                wall = Date.UTC(y, m - 1, Math.min(e.day, daysInMonth(y, m)), e.hour, e.minute, e.second);
            }
            if (! (Number.isFinite(wall) &&
                   (wall >= ((MIN_TIME - (2 * DAY)) * 1000)) &&
                   (wall <= ((MAX_TIME + (2 * DAY)) * 1000)))) {
                return undefined;
            }
            t = wallToTime(wall, s.timeZone);
        }
        return ((Number.isSafeInteger(t) && (t >= MIN_TIME) && (t <= (MAX_TIME + 1))) ? t : undefined);
    }

    // Index estimate for an instant. Exact for fixed periods; for calendar
    // periods it is local-clock arithmetic, off by at most one around a
    // DST transition that overlaps the period boundary.
    #estimate(t) {
        const s = this.#spec;
        if (s.type === 'fixed') {
            return Math.floor((t - s.epoch) / s.length);
        }
        const T = localFields(t, s.timeZone);
        const E = s.fields;
        const tod = ((T.hour - E.hour) || (T.minute - E.minute) || (T.second - E.second));
        if (s.days) {
            let d = Math.round((Date.UTC(T.year, T.month - 1, T.day) - Date.UTC(E.year, E.month - 1, E.day)) / (DAY * 1000));
            if (tod < 0) {
                d -= 1;
            }
            return Math.floor(d / s.days);
        }
        let m = ((T.year - E.year) * 12) + (T.month - E.month);
        // The epoch day constrained to the month at hand, as #first does.
        const d = Math.min(E.day, daysInMonth(T.year, T.month));
        if (((T.day - d) || tod) < 0) {
            m -= 1;
        }
        return Math.floor(m / s.months);
    }

    #period(index, first, last) {
        return Object.freeze({ index, first, last, uri: uriBuild(this.#public, index), spec: this.#public });
    }

}

PeriodCalc.SCHEME = SCHEME;
PeriodCalc.MIN_TIME = MIN_TIME;
PeriodCalc.MAX_TIME = MAX_TIME;

module.exports = PeriodCalc;
