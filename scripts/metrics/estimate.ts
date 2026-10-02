/**
 * Best-effort split of npm's download counts into what we can explain and what
 * is left over, which we treat as likely real use.
 *
 * npm counts every tarball fetch, so a raw total mixes three things:
 *
 * - Release noise. Publishing sets off mirrors and security scanners fetching
 *   the new tarball, plus our own checks of the release. Everything on a
 *   publish day and the `releaseWindowDays` after it is set aside.
 * - Registry crawlers. They fetch every published version, old ones included,
 *   at a steady rate. The rate is calibrated from npm's per-version counts for
 *   the last week: nobody installs a superseded version on purpose, so what
 *   old versions get is what crawlers do. On quiet days each published version
 *   is charged that rate, capped at what the week actually had.
 * - The rest: likely real downloads. Still downloads, not people.
 *
 * CI in this repo contributes nothing: it installs a locally packed tarball
 * with `--no-install`, and the release job only reads version metadata, which
 * npm does not count as a download.
 *
 * Pure on purpose, so tests can pin the method against real snapshots.
 */

export interface CrawlerRates {
  /** Downloads per published version per day. */
  low: number;
  mid: number;
  high: number;
  /** False when there was no per-version snapshot to calibrate from. */
  calibrated: boolean;
}

export interface WeekRow {
  /** Monday of the week (UTC), YYYY-MM-DD. */
  week: string;
  /** Days of data in this week (the first and last weeks can be partial). */
  days: number;
  total: number;
  release: number;
  quiet: number;
  crawlers: number;
  likelyReal: number;
  /** Likely real if crawlers ran at the high rate. */
  likelyRealLow: number;
  /** Likely real if crawlers ran at the low rate. */
  likelyRealHigh: number;
}

export interface Estimate {
  total: number;
  release: number;
  crawlers: number;
  likelyReal: number;
  likelyRealLow: number;
  likelyRealHigh: number;
  rates: CrawlerRates;
  releaseDays: string[];
  weeks: WeekRow[];
}

export interface EstimateInput {
  /** Downloads per UTC day, YYYY-MM-DD → count. */
  daily: Record<string, number>;
  /** Version → publish timestamp, as in the registry's `time` field. */
  published: Record<string, string>;
  /** npm's `/versions/<pkg>/last-week` counts, when available. */
  lastWeekByVersion?: Record<string, number>;
  /** The `latest` dist-tag when the snapshot was taken. */
  latest?: string;
  /** The day the per-version snapshot was taken, YYYY-MM-DD. */
  snapshotDay?: string;
  /** Days after a publish day that also count as release noise. */
  releaseWindowDays?: number;
}

/** 1 to 3 hits per version per week, the spread seen in the first snapshot. */
export const DEFAULT_RATES: CrawlerRates = { low: 1 / 7, mid: 0.25, high: 3 / 7, calibrated: false };

const DAY_MS = 86_400_000;

export function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  return toDay(dayMs(day) + n * DAY_MS);
}

/** Monday of the UTC week containing `day`. */
export function weekOf(day: string): string {
  const weekday = new Date(dayMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * Crawler rates from one week of per-version counts. Versions still inside
 * their first week are left out, because their counts are mostly release
 * noise, and so is `latest`, the one version people actually pick.
 */
export function calibrateCrawlerRates(
  lastWeekByVersion: Record<string, number> | undefined,
  published: Record<string, string>,
  latest?: string,
  snapshotDay?: string,
): CrawlerRates {
  if (!lastWeekByVersion) return DEFAULT_RATES;
  const cutoff = snapshotDay ? addDays(snapshotDay, -7) : undefined;
  const old = Object.entries(lastWeekByVersion)
    .filter(([version]) => version !== latest)
    .filter(([version]) => {
      const at = published[version];
      if (!at) return false;
      return cutoff === undefined || at.slice(0, 10) < cutoff;
    })
    .map(([, count]) => count);
  if (old.length === 0) return DEFAULT_RATES;
  const sum = old.reduce((a, b) => a + b, 0);
  return {
    low: Math.min(...old) / 7,
    mid: sum / old.length / 7,
    high: Math.max(...old) / 7,
    calibrated: true,
  };
}

export function estimateRealDownloads(input: EstimateInput): Estimate {
  const windowDays = input.releaseWindowDays ?? 1;
  const rates = calibrateCrawlerRates(input.lastWeekByVersion, input.published, input.latest, input.snapshotDay);

  const publishDays = Object.values(input.published)
    .map((at) => at.slice(0, 10))
    .sort();
  const releaseDays = [...new Set(publishDays)];
  const inWindow = new Set<string>();
  for (const day of releaseDays) {
    for (let k = 0; k <= windowDays; k++) inWindow.add(addDays(day, k));
  }
  const versionsBy = (day: string) => publishDays.filter((d) => d <= day).length;

  interface Acc {
    days: number;
    total: number;
    release: number;
    quiet: number;
    budgetLow: number;
    budgetMid: number;
    budgetHigh: number;
  }
  const weeks = new Map<string, Acc>();
  for (const day of Object.keys(input.daily).sort()) {
    const count = input.daily[day] ?? 0;
    const key = weekOf(day);
    const acc = weeks.get(key) ?? { days: 0, total: 0, release: 0, quiet: 0, budgetLow: 0, budgetMid: 0, budgetHigh: 0 };
    acc.days += 1;
    acc.total += count;
    if (inWindow.has(day)) {
      acc.release += count;
    } else {
      const n = versionsBy(day);
      acc.quiet += count;
      acc.budgetLow += rates.low * n;
      acc.budgetMid += rates.mid * n;
      acc.budgetHigh += rates.high * n;
    }
    weeks.set(key, acc);
  }

  const rows: WeekRow[] = [...weeks.entries()].map(([week, a]) => {
    const crawlers = Math.min(a.quiet, a.budgetMid);
    return {
      week,
      days: a.days,
      total: a.total,
      release: a.release,
      quiet: a.quiet,
      crawlers,
      likelyReal: a.quiet - crawlers,
      likelyRealLow: a.quiet - Math.min(a.quiet, a.budgetHigh),
      likelyRealHigh: a.quiet - Math.min(a.quiet, a.budgetLow),
    };
  });

  const sum = (pick: (r: WeekRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  return {
    total: sum((r) => r.total),
    release: sum((r) => r.release),
    crawlers: sum((r) => r.crawlers),
    likelyReal: sum((r) => r.likelyReal),
    likelyRealLow: sum((r) => r.likelyRealLow),
    likelyRealHigh: sum((r) => r.likelyRealHigh),
    rates,
    releaseDays,
    weeks: rows,
  };
}
