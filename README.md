# tr-period-calc

Canonical sequential period indexing for Node.js with zero dependencies.

Given a spec, every instant in time belongs to exactly one period, and
every period has an integer index: period 0 starts at the epoch, period 1
follows it, period -1 precedes it. The mapping is fixed for the life of
the spec, so periodic statistics can be assigned to a period once and
found again forever, on any machine, in any process, at any later date.

Two kinds of spec are supported:

- **Fixed**: an epoch in unix seconds and a length in seconds. This is
  plain unix-time arithmetic. Fifteen-minute periods anchored at
  12:00:00 UTC stay at `*:00`, `*:15`, `*:30`, `*:45` UTC forever,
  regardless of DST or leap years, because that is what unix time does.
- **Calendar**: an epoch as a local date-time, a length of one or more
  days, weeks, months or years, and an IANA time zone. Period boundaries
  follow the local clock: a week starting Monday 08:00 in New York starts
  at 08:00 local every Monday, and the week in which DST begins is one
  hour shorter.

A spec, and a single period of it, can be written as a self-contained
URI:

```
tr-period-calc://?epoch=1788964903&length=600
tr-period-calc://1231?epoch=1788964903&length=600
tr-period-calc://?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York
tr-period-calc://8?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York
```

The first is a spec (ten-minute periods from 2026-09-09T14:41:43Z), the
second is its period 1231. The URI carries everything needed to recompute
the period's boundaries, so it makes a good key for stored data.

Time zone support is whatever `Intl` in the running Node.js provides; no
zone data is bundled.

# Reference

## Installation

```sh
npm install tr-period-calc
```

Node.js `>=18.0.0` is required.

## Exports

```js
const PeriodCalc = require('tr-period-calc');
```

The class is the only export.

## Quick start

```js
const PeriodCalc = require('tr-period-calc');

// weeks starting Monday 08:00 New York time
const weeks = new PeriodCalc({ epoch: '2026-01-05 08:00', length: 'week', timeZone: 'America/New_York' });

weeks.uri;
// 'tr-period-calc://?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York'

const p = weeks.byTime(1772967600);          // 2026-03-08T11:00:00Z, a Sunday
p.index;                                     // 8
p.first;                                     // 1772456400 = 2026-03-02T13:00:00Z (Mon 08:00 EST)
p.last;                                      // 1773057599 = 2026-03-09T11:59:59Z (Mon 07:59:59 EDT)
p.uri;
// 'tr-period-calc://8?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York'

weeks.byIndex(9).first;                      // 1773057600, one second after p.last
weeks.localTime(p.first).dateTimeStr;        // '2026-03-02T08:00:00'

// later, anywhere, from a stored key
PeriodCalc.periodByUri(p.uri).first;         // 1772456400
```

## Specs

A spec is given to the constructor as an object or as a URI. The object
form has three fields:

- `epoch`: the start of period 0. A unix-second integer (number or
  numeric string), a `Date`, or a local date-time string
  `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS` (`T` is
  accepted in place of the space). A date-time string is read in
  `timeZone`.
- `length`: a positive integer number of seconds (number or numeric
  string) for a fixed spec, or `day`, `week`, `month` or `year` with an
  optional multiplier (`3month`, `2week`) for a calendar spec.
- `timeZone`: an IANA time zone name, optional, default `UTC`. Names are
  matched case-insensitively (`europe/helsinki`), with underscores,
  dashes and spaces interchangeable (`America/New York`). Any other
  name `Intl` accepts (`US/Eastern`) is used with the spelling given.

The spec is normalized on construction:

- A **fixed** spec is stored as a unix-second `epoch`, a numeric `length`
  and `timeZone: 'UTC'`. A date-time epoch is converted using the given
  zone and the zone is then dropped, since it has no effect on unix-time
  periods. Giving a non-UTC zone together with a unix-second epoch is an
  error rather than silently ignored.
- A **calendar** spec is stored as a `YYYY-MM-DDTHH:MM:SS` epoch, the
  length as `[N]unit` with `N` omitted when 1, and the zone. A unix-second
  epoch is converted to the local date-time in the zone.

The legacy spec objects of `periodCalculator.js` are accepted as they
are: `{ periodEpoch, periodLength }` and
`{ calendarEpoch, calendarPeriodLength, timeZone }`. Keys other than
these and the three above are an error.

## URIs

```
tr-period-calc://[index]?epoch=<epoch>&length=<length>[&tz=<zone>]
```

- `index` is an optional integer, negative allowed, no leading zeros.
  Without it the URI names a spec, with it a single period.
- `epoch`, `length` and `tz` carry the spec fields exactly as described
  above. `tz` is omitted for `UTC`. Parameters may be given in any
  order and percent-encoded, but each at most once, and no other
  parameters are allowed; a URI a future version might produce must not
  be silently misread by this one.
- The scheme is matched case-insensitively. A `/` before the `?` is
  tolerated.

Every calculator and every period exposes its canonical URI, which is
the normalized spec in the fixed parameter order with a zone name
percent-encoded only where necessary (`Etc/GMT%2B3`). Two calculators
are equal exactly when their canonical URIs are equal.

## Periods

A period is a frozen plain object:

```js
{
    index: 8,             // integer
    first: 1772456400,    // unix seconds, inclusive
    last: 1773057599,     // unix seconds, inclusive
    uri: 'tr-period-calc://8?epoch=2026-01-05T08:00:00&length=week&tz=America/New_York',
    spec: { epoch: '2026-01-05T08:00:00', length: 'week', timeZone: 'America/New_York' }
}
```

Periods are contiguous and disjoint: `last` is always one second before
the next period's `first`. For fixed specs `last - first + 1` is the
length; for calendar specs it varies with DST and month length.

Calendar period boundaries are local wall-clock times. Where the wall
clock is ambiguous they follow the same rules as the legacy `Date`
constructor and Temporal's `compatible` disambiguation:

- A time that does not exist because clocks moved forward is pushed
  forward by the size of the gap: daily periods from 03:30 in Helsinki
  start at 04:30 on the day the gap swallows 03:00–03:59.
- A time that occurs twice because clocks moved back resolves to its
  first occurrence.
- A day of month beyond the end of a month is constrained to the last
  day of that month: monthly periods from January 31 start on February
  28 (or 29), March 31, April 30. Yearly periods from February 29 start
  on February 28 in common years.

The `index` of a time is always consistent with these boundaries. With
an epoch time-of-day inside a DST transition it can happen that, by the
wall clock alone, a time seems to fall on the other side of a boundary
than it does by the instant; the instant wins.

The supported range is 1000-01-01T00:00:00Z to 9999-12-31T23:59:59Z
(`PeriodCalc.MIN_TIME` and `PeriodCalc.MAX_TIME`). Times, epochs and
period boundaries outside it are errors.

## `new PeriodCalc(spec)`

`spec` is a spec object, a spec URI, a period URI (the index is
ignored), or another `PeriodCalc`. Throws `Invalid spec`, `Invalid URI`
or `Invalid time zone`.

## Instance properties

- `spec`: the normalized spec, a frozen `{ epoch, length, timeZone }`
- `uri`: the canonical spec URI
- `type`: `'fixed'` or `'calendar'`

`toString()` and `toJSON()` return the URI, so a calculator can be
stored in JSON and restored with `new PeriodCalc(...)`.

## `equals(other)`

`other` is a `PeriodCalc` or anything the constructor accepts. True when
the canonical URIs match.

## `byIndex(index)`

The period with the given integer index. Throws `Invalid index` when
the period does not lie inside the supported range.

## `byTime(time)`

The period containing `time`: unix seconds as a number (a fraction is
floored), a `Date`, or nothing for the current time. Milliseconds passed
by mistake fall outside the supported range and throw `Invalid time`.

## `byDateTime(dateTime, timeZone)`

The period containing the local date-time string `dateTime` (formats as
for a spec epoch), read in `timeZone`, default the spec's zone. Note
that a fixed spec's zone is always `UTC`.

## `byUri(uri)`

The period named by a period URI of this spec. Throws `Invalid URI` for
a spec URI without an index and `Spec mismatch` for a period of another
spec. Use it to validate stored keys against the spec they are supposed
to belong to; `PeriodCalc.periodByUri` accepts any spec.

## `range(from, to)`

An array of the periods from the one containing `from` to the one
containing `to`, inclusive, in index order. Times as for `byTime`.
Throws `Invalid time` when `to` precedes `from`'s period.

## `localTime(time, timeZone)` / `PeriodCalc.localTime(time, timeZone)`

The local wall-clock view of an instant:

```js
{
    time: 1774747800,             // the instant, unix seconds
    timeZone: 'Europe/Helsinki',
    year: 2026, month: 3, day: 29, hour: 4, minute: 30, second: 0,
    weekday: 0,                   // 0 = Sunday .. 6 = Saturday
    offset: 10800,                // seconds east of UTC at that instant
    dateStr: '2026-03-29',
    timeStr: '04:30:00',
    dateTimeStr: '2026-03-29T04:30:00'
}
```

`time` as for `byTime`. The instance method defaults `timeZone` to the
spec's zone, the static one to `UTC`.

## `parseDateTime(dateTime, timeZone)` / `PeriodCalc.parseDateTime(dateTime, timeZone)`

A local date-time string (formats as for a spec epoch) in a zone to unix
seconds, with the gap and overlap rules above. Defaults for `timeZone`
as for `localTime`. Throws `Invalid datetime`.

## `PeriodCalc.parseUri(uri)`

`{ spec, index }` for a URI: the normalized spec object and the integer
index, `undefined` when the URI has none.

## `PeriodCalc.periodByUri(uri)`

The period named by a period URI, of whatever spec. Throws
`Invalid URI` when the URI has no index.

## `PeriodCalc.normalizeTimeZone(timeZone)`

The canonical zone name for the spec, `UTC` for nothing. Throws
`Invalid time zone`.

## `PeriodCalc.SCHEME`, `PeriodCalc.MIN_TIME`, `PeriodCalc.MAX_TIME`

The URI scheme `tr-period-calc` and the supported range in unix seconds.

## Example: Nord Pool market periods

`examples/nordpool.js` defines the periods of the Nord Pool day-ahead
market as three specs sharing one epoch, the first traded hour,
1993-01-01 00:00 CET:

- market days: calendar days in CET/CEST (`length=day&tz=CET`), which
  every country in the system follows whatever its own zone
- market hours: `length=3600` from the epoch
- market quarters: `length=900` from the epoch

Hours and quarters do not divide days evenly. The day DST starts has 23
hours and the day it ends has 25, so the module answers "which hours
make up this day" and "which day is this hour in" by time, never by
division. It also carries the countries of the system with their zones,
so a market day can be shown on each country's clock: 01:00 to 01:00 in
Finland and the Baltics, 23:00 to 23:00 in Ireland and Portugal.

`examples/nordpool-cli` is a command line tool on top of it. Run
`npm install` once for its option parser.

```sh
node examples/nordpool-cli                          # now
node examples/nordpool-cli '2026-10-25 12:00'       # a time in the local zone
node examples/nordpool-cli --utc 1993-01-02T00:00   # in UTC, or --tz=<zone>
node examples/nordpool-cli day 12350                # first and last second
node examples/nordpool-cli describe hour 25         # with what it belongs to
node examples/nordpool-cli --json describe hour 25  # every instant in UTC, market, local and --tz time
```

A timestamp with a `Z` or `±HH:MM` suffix carries its own zone, and unix
seconds are accepted as they are. Hour 25 with times shown in market
time:

```
$ node examples/nordpool-cli --tz=CET describe hour 25
Hour 25  (times in CET (tz))
  uri       tr-period-calc://25?epoch=725842800&length=3600
  first     1993-01-02 01:00:00  725932800
  last      1993-01-02 01:59:59  725936399
  length    3600 s
  day       1  1993-01-02 00:00:00 – 1993-01-02 23:59:59
  quarters  100 – 103  (4)
  on each country's clock
    Germany      Europe/Berlin      1993-01-02 01:00:00 – 1993-01-02 01:59:59
    France       Europe/Paris       1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Norway       Europe/Oslo        1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Sweden       Europe/Stockholm   1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Denmark      Europe/Copenhagen  1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Netherlands  Europe/Amsterdam   1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Belgium      Europe/Brussels    1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Austria      Europe/Vienna      1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Luxembourg   Europe/Luxembourg  1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Poland       Europe/Warsaw      1993-01-02 01:00:00 – 1993-01-02 01:59:59
    Finland      Europe/Helsinki    1993-01-02 02:00:00 – 1993-01-02 02:59:59
    Estonia      Europe/Tallinn     1993-01-02 02:00:00 – 1993-01-02 02:59:59
    Latvia       Europe/Riga        1993-01-02 02:00:00 – 1993-01-02 02:59:59
    Lithuania    Europe/Vilnius     1993-01-02 02:00:00 – 1993-01-02 02:59:59
    Ireland      Europe/Dublin      1993-01-02 00:00:00 – 1993-01-02 00:59:59
    Portugal     Europe/Lisbon      1993-01-02 01:00:00 – 1993-01-02 01:59:59
```

The day DST ends in 2026 has 25 hours and 100 quarters:

```
$ node examples/nordpool-cli --tz=CET describe day 12350
Day 12350  (times in CET (tz))
  uri       tr-period-calc://12350?epoch=1993-01-01T00:00:00&length=day&tz=CET
  first     2026-10-25 00:00:00  1792879200
  last      2026-10-25 23:59:59  1792969199
  length    90000 s (25 h)
  hours     296399 – 296423  (25)
  quarters  1185596 – 1185695  (100)
  on each country's clock
    ...
```

## Performance

Fixed-spec lookups are integer arithmetic and cost a fraction of a
microsecond. Calendar-spec lookups go through `Intl.DateTimeFormat` a
dozen or so times and cost on the order of ten microseconds each; the
formatters are cached per zone. Constructing a calculator from a URI is
about a microsecond, so there is no need to cache calculators.

## Errors

All errors are plain `Error` with one of the messages `Invalid spec`,
`Invalid URI`, `Invalid time zone`, `Invalid time`, `Invalid index`,
`Invalid datetime` or `Spec mismatch`. Inputs are validated strictly
and never coerced, except that time arguments accept a `Date` and
fractional seconds, and the constructor accepts numeric strings for the
fields a URI carries as strings.

## Relation to `periodCalculator.js`

This package supersedes the standalone `periodCalculator.js` functions.
Period indexes and starts are identical for every spec both accept, and
the test suite runs the legacy code side by side to keep it so. The
differences are deliberate:

- Periods are always contiguous. The legacy `last` came from separate
  wall-clock arithmetic and left a one-hour gap in zones whose DST
  change falls exactly on the period boundary time.
- A time whose wall-clock reading contradicts the period boundaries
  (possible only with an epoch time-of-day inside a DST transition) is
  assigned by the boundaries.
- Monthly periods from the 29th to 31st and yearly periods from February
  29 are constrained to the last day of shorter months instead of
  overflowing into the following month.
- A time zone together with a fixed-length spec and a unix-second epoch
  is an error instead of being ignored.
- The zone is looked up through `Intl.DateTimeFormat` instead of
  rewriting `process.env.TZ`, which was process-global.

# Author

Timo J. Rinne <tri@iki.fi> — https://github.com/rinne/

# Copyright

Copyright © 2026 Timo J. Rinne <tri@iki.fi>.
See `COPYING` for the full MIT license text.

# License

MIT License
