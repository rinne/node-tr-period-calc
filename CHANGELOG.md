# Changelog

All notable changes to this package are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The source lives
at [github.com/rinne/node-tr-period-calc](https://github.com/rinne/node-tr-period-calc).

## [1.0.0] - 2026-09-09

### Added

- `PeriodCalc` class: sequential period indexing from a spec that is either
  fixed (unix-second epoch and length in seconds) or calendar (local date-time
  epoch, `N × day|week|month|year`, IANA time zone). `byIndex`, `byTime`,
  `byDateTime`, `byUri`, `range`, `localTime`, `parseDateTime`, `equals`.
- The `tr-period-calc://[index]?epoch=…&length=…[&tz=…]` URI form for a spec
  or a single self-contained period, with `PeriodCalc.parseUri` and
  `PeriodCalc.periodByUri`. Every calculator and period exposes its canonical
  URI.
- Calendar periods are computed with `Intl.DateTimeFormat` instead of
  rewriting `process.env.TZ`; the local-clock rules match legacy `Date`
  (and Temporal's `compatible` disambiguation): a time in a DST gap moves
  forward by the gap, a repeated time resolves to its first occurrence.
- Calendar lengths take a multiplier (`3month` for quarters, `2week`).
- A demonstration under `examples/`: `nordpool.js` defines Nord Pool market
  days (calendar days in CET), hours and quarters from the epoch
  1993-01-01 00:00 CET, with the countries of the system and their zones;
  `nordpool-cli` looks up the periods of a time, the limits of a period, or
  describes one with the periods it belongs to and contains, in local time,
  UTC or a given zone, as text or JSON. `optist` becomes a devDependency for
  it.
- The legacy spec objects of `periodCalculator.js` (`periodEpoch` /
  `periodLength` and `calendarEpoch` / `calendarPeriodLength` / `timeZone`)
  are accepted as they are. Indexes and period starts are identical to the
  legacy implementation; the compatibility test runs the legacy code side by
  side.

### Changed

Relative to `periodCalculator.js`, on purpose:

- A period always ends one second before the next one starts. The legacy
  `last` was computed from local wall-clock arithmetic and left a gap in
  zones whose DST change falls exactly on the period boundary time.
- A time whose period assignment by local clock contradicts the period
  boundaries (only possible when the epoch time-of-day lies inside a DST
  transition) is assigned by the boundaries.
- Monthly periods from the 29th to 31st and yearly periods from Feb 29 are
  constrained to the last day of shorter months instead of overflowing into
  the following month.
- A time zone given with a fixed-length spec and a unix-second epoch is an
  error, since it would have no effect.
