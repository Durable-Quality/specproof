import { describe, expect, it } from 'vitest';

import { calibrateCrawlerRates, DEFAULT_RATES, estimateRealDownloads, weekOf } from '../../scripts/metrics/estimate';
import { mergeAdopters, mergeDaily, parseDependentsPage, parseSpecproofDependency, trafficToDaily } from '../../scripts/metrics/merge';
import { renderReport, type Summary } from '../../scripts/metrics/report';

// Real npm data for specproof, 13 Jul – 28 Sep 2026, as pulled on 29 Sep. The
// first adoption report was built from exactly these numbers, so the method
// is pinned to what that report said: ~397 likely real downloads, 304–470.
const DAILY_COUNTS = [
  121, 263, 292, 26, 9, 13, 7, 7, 123, 15, 86, 30, 6, 0, 0, 3, 7, 359, 27, 278, 25, 18, 38, 4, 7, 25, 9, 5, 6, 16, 10, 10, 0, 0, 0,
  2, 12, 2, 2, 1, 159, 12, 18, 13, 4, 1, 1, 7, 2, 6, 5, 12, 0, 637, 41, 40, 0, 0, 4, 18, 30, 20, 14, 7, 0, 3, 8, 1, 1, 0, 0, 1, 0,
  0, 0, 19, 11, 0,
];
const REAL_DAILY = Object.fromEntries(
  DAILY_COUNTS.map((n, i) => [new Date(Date.UTC(2026, 6, 13 + i)).toISOString().slice(0, 10), n]),
);
const REAL_PUBLISHED: Record<string, string> = {
  '0.1.0': '2026-07-13T13:47:04.575Z',
  '0.2.0': '2026-07-14T17:26:02.705Z',
  '0.2.1': '2026-07-14T18:09:42.068Z',
  '0.3.0': '2026-07-15T18:20:20.793Z',
  '0.4.0': '2026-07-15T19:48:27.112Z',
  '0.5.0': '2026-07-21T18:17:35.830Z',
  '0.6.0': '2026-07-30T16:59:14.026Z',
  '0.6.1': '2026-07-30T17:43:06.345Z',
  '0.7.0': '2026-07-30T19:57:40.391Z',
  '0.7.1': '2026-08-01T19:22:45.561Z',
  '0.7.2': '2026-08-01T20:29:29.295Z',
  '0.8.0': '2026-08-22T12:26:13.884Z',
  '0.9.0': '2026-09-04T17:04:12.663Z',
  '0.9.1': '2026-09-04T17:42:48.933Z',
  '0.9.2': '2026-09-04T20:32:57.030Z',
  '0.9.3': '2026-09-04T20:49:09.685Z',
  '0.9.4': '2026-09-04T21:06:47.220Z',
};
const REAL_LAST_WEEK: Record<string, number> = {
  '0.9.3': 3, '0.2.0': 1, '0.6.0': 2, '0.9.4': 3, '0.1.0': 1, '0.7.2': 2, '0.6.1': 2, '0.2.1': 1, '0.7.1': 2,
  '0.5.0': 1, '0.3.0': 1, '0.9.1': 2, '0.9.2': 2, '0.7.0': 2, '0.4.0': 1, '0.8.0': 2, '0.9.0': 3,
};

describe('estimateRealDownloads', () => {
  it('reproduces the first adoption report from the real 29 Sep snapshot', () => {
    const e = estimateRealDownloads({
      daily: REAL_DAILY,
      published: REAL_PUBLISHED,
      lastWeekByVersion: REAL_LAST_WEEK,
      latest: '0.9.4',
      snapshotDay: '2026-09-29',
    });
    expect(e.total).toBe(2959);
    expect(e.release).toBe(2378);
    expect(e.rates.calibrated).toBe(true);
    expect(e.rates.mid).toBeCloseTo(0.25, 5);
    expect(Math.round(e.likelyReal)).toBeGreaterThanOrEqual(396);
    expect(Math.round(e.likelyReal)).toBeLessThanOrEqual(398);
    expect(Math.round(e.likelyRealLow)).toBeGreaterThanOrEqual(303);
    expect(Math.round(e.likelyRealLow)).toBeLessThanOrEqual(305);
    expect(Math.round(e.likelyRealHigh)).toBeGreaterThanOrEqual(469);
    expect(Math.round(e.likelyRealHigh)).toBeLessThanOrEqual(471);
    // Every download lands in exactly one bucket.
    expect(e.release + e.crawlers + e.likelyReal).toBeCloseTo(e.total, 6);
  });

  it('sets aside the publish day and the day after as release noise', () => {
    const e = estimateRealDownloads({
      daily: { '2026-01-05': 100, '2026-01-06': 50, '2026-01-07': 5 },
      published: { '1.0.0': '2026-01-05T10:00:00Z' },
    });
    expect(e.release).toBe(150);
    expect(e.releaseDays).toEqual(['2026-01-05']);
  });

  it('charges crawlers per published version and never more than the quiet days had', () => {
    const published = { '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-01-01T01:00:00Z' };
    // Week of 12 Jan: 7 quiet days, 2 versions, mid rate 0.25 → budget 3.5.
    const busy = estimateRealDownloads({
      daily: Object.fromEntries([12, 13, 14, 15, 16, 17, 18].map((d) => [`2026-01-${d}`, 2])),
      published,
    });
    expect(busy.crawlers).toBeCloseTo(3.5, 6);
    expect(busy.likelyReal).toBeCloseTo(14 - 3.5, 6);

    // One quiet day with 8 versions out: a budget of 2, but only 1 download to charge it to.
    const eight = Object.fromEntries([...Array(8).keys()].map((i) => [`1.${i}.0`, '2026-01-01T00:00:00Z']));
    const quiet = estimateRealDownloads({ daily: { '2026-01-12': 1 }, published: eight });
    expect(quiet.crawlers).toBe(1);
    expect(quiet.likelyReal).toBe(0);
  });

  it('groups days into Monday-based UTC weeks', () => {
    expect(weekOf('2026-09-28')).toBe('2026-09-28'); // Monday
    expect(weekOf('2026-09-27')).toBe('2026-09-21'); // Sunday
    expect(weekOf('2026-07-13')).toBe('2026-07-13');
  });
});

describe('calibrateCrawlerRates', () => {
  it('uses superseded versions only, and ignores ones still in their first week', () => {
    const rates = calibrateCrawlerRates(
      { '1.0.0': 7, '1.1.0': 14, '1.2.0': 700, '2.0.0': 70 },
      { '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-01-02T00:00:00Z', '1.2.0': '2026-03-09T00:00:00Z', '2.0.0': '2026-01-03T00:00:00Z' },
      '2.0.0',
      '2026-03-10',
    );
    expect(rates).toEqual({ low: 1, mid: 1.5, high: 2, calibrated: true });
  });

  it('falls back to the default spread without a snapshot', () => {
    expect(calibrateCrawlerRates(undefined, {})).toEqual(DEFAULT_RATES);
    expect(calibrateCrawlerRates({ '1.0.0': 3 }, { '1.0.0': '2026-01-01T00:00:00Z' }, '1.0.0')).toEqual(DEFAULT_RATES);
  });
});

describe('metrics history merging', () => {
  it('keeps old days, lets a later fetch of the same day win, and sorts by day', () => {
    const merged = mergeDaily({ '2026-01-02': 1, '2026-01-01': 5 }, { '2026-01-02': 3, '2026-01-03': 4 });
    expect(Object.entries(merged)).toEqual([
      ['2026-01-01', 5],
      ['2026-01-02', 3],
      ['2026-01-03', 4],
    ]);
  });

  it('reads GitHub traffic series by UTC day', () => {
    expect(trafficToDaily([{ timestamp: '2026-09-20T00:00:00Z', count: 9, uniques: 4 }])).toEqual({ '2026-09-20': { count: 9, uniques: 4 } });
  });

  it('keeps when an adopter was first seen, and keeps ones that stopped showing up', () => {
    const base = { kind: 'package.json' as const, path: 'package.json', url: 'u', internal: false };
    const day1 = mergeAdopters([], [{ ...base, repo: 'acme/api', version: '^0.9.0' }, { ...base, repo: 'old/gone' }], '2026-10-01');
    const day2 = mergeAdopters(day1, [{ ...base, repo: 'acme/api', version: '^0.10.0' }], '2026-10-02');
    const acme = day2.find((a) => a.repo === 'acme/api')!;
    expect(acme).toMatchObject({ firstSeen: '2026-10-01', lastSeen: '2026-10-02', version: '^0.10.0' });
    expect(day2.find((a) => a.repo === 'old/gone')).toMatchObject({ firstSeen: '2026-10-01', lastSeen: '2026-10-01' });
  });

  it('reads the declared version from a code-search fragment and ignores bare mentions', () => {
    expect(parseSpecproofDependency('  "devDependencies": {\n    "specproof": "^0.9.4",\n')).toBe('^0.9.4');
    expect(parseSpecproofDependency('"name": "specproof",')).toBeUndefined();
    expect(parseSpecproofDependency('"audit": "specproof generate --check"')).toBeUndefined();
  });
});

describe('parseDependentsPage', () => {
  const page = `
    <a class="btn-link selected" href="/Durable-Quality/specproof/network/dependents?dependent_type=REPOSITORY">
      <svg></svg>
      1,204
      Repositories
    </a>
    <a class="btn-link" href="/Durable-Quality/specproof/network/dependents?dependent_type=PACKAGE">3 Packages</a>
    <div class="Box-row" data-test-id="dg-repo-pkg-dependent">
      <a data-hovercard-type="user" href="/acme">acme</a> /
      <a class="text-bold" data-hovercard-type="repository" data-hovercard-url="/acme/api/hovercard" href="/acme/api">api</a>
    </div>
    <div class="Box-row" data-test-id="dg-repo-pkg-dependent">
      <a data-hovercard-type="repository" href="/Durable-Quality/specproof">specproof</a>
      <a href="/beta/web" class="text-bold" data-hovercard-type="repository">web</a>
    </div>
    <div class="paginate-container">
      <button disabled="disabled">Previous</button>
      <a rel="nofollow" class="btn" href="https://github.com/Durable-Quality/specproof/network/dependents?dependent_type=REPOSITORY&amp;dependents_after=MTIz">Next</a>
    </div>`;

  it('reads the count, the dependent repos (not ourselves), and the next page', () => {
    expect(parseDependentsPage(page, 'Durable-Quality/specproof')).toEqual({
      count: 1204,
      repos: ['acme/api', 'beta/web'],
      next: 'https://github.com/Durable-Quality/specproof/network/dependents?dependent_type=REPOSITORY&dependents_after=MTIz',
    });
  });

  it('reads the empty state as zero', () => {
    const empty = "<div class='blankslate'><h3>We haven’t found any dependents for this repository yet.</h3></div>";
    expect(parseDependentsPage(empty, 'a/b')).toEqual({ count: 0, repos: [], next: null });
  });

  it('throws on a page it does not recognise instead of reporting zero', () => {
    expect(() => parseDependentsPage('<html><body>Sign in to GitHub</body></html>', 'a/b')).toThrow(/not recognised/);
  });
});

describe('renderReport', () => {
  const summary: Summary = {
    generatedAt: '2026-09-30T04:41:00.000Z',
    package: 'specproof',
    repo: 'Durable-Quality/specproof',
    npm: {
      latest: '0.9.4',
      versions: 17,
      firstPublished: '2026-07-13',
      lastDay: '2026-09-28',
      estimate: estimateRealDownloads({
        daily: REAL_DAILY,
        published: REAL_PUBLISHED,
        lastWeekByVersion: REAL_LAST_WEEK,
        latest: '0.9.4',
        snapshotDay: '2026-09-29',
      }),
    },
    github: { stars: 5, forks: 0, watchers: 0, issuesOpen: 0, issuesClosed: 0, prsOpen: 1, prsMerged: 20, prsClosedUnmerged: 2 },
    adopters: { external: [], internalCount: 2, newToday: [], dependentsCount: 0 },
    errors: [{ source: 'GitHub traffic', message: 'needs METRICS_TOKEN' }],
  };

  it('leads with the all-time and recent likely-real estimates', () => {
    const md = renderReport(summary);
    expect(md).toContain('| All time | 2,959 |');
    expect(md).toContain('**~397** (304–470)');
    expect(md).toContain('Likely real, last 4 full weeks');
  });

  it('counts issues and pull requests separately', () => {
    const md = renderReport(summary);
    expect(md).toContain('| Issues open | Issues closed | PRs open |');
    expect(md).toContain('| 5 | 0 | 0 | 0 | 0 | 1 | 20 | 2 |');
  });

  it('says plainly when no outside adopters were found, and lists failed sources', () => {
    const md = renderReport(summary);
    expect(md).toContain('No repositories outside our own found yet.');
    expect(md).toContain('2 matches in our own repos left out');
    expect(md).toContain('- **GitHub traffic**: needs METRICS_TOKEN');
  });
});
