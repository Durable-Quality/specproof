/**
 * Renders a run's summary as the README of the `metrics` branch (and the
 * workflow's step summary), so the numbers can be read on GitHub without
 * opening any JSON.
 */

import type { Estimate, WeekRow } from './estimate';
import type { Adopter, DayCount } from './merge';

export interface RepoStats {
  stars: number;
  forks: number;
  watchers: number;
  issuesOpen: number;
  issuesClosed: number;
  prsOpen: number;
  prsMerged: number;
  prsClosedUnmerged: number;
}

export interface Referrer {
  referrer: string;
  count: number;
  uniques: number;
}

export interface Summary {
  generatedAt: string;
  package: string;
  repo: string;
  npm?: {
    latest: string;
    versions: number;
    firstPublished: string;
    lastDay: string;
    estimate: Estimate;
  };
  github?: RepoStats;
  traffic?: {
    views: DayCount;
    clones: DayCount;
    referrers: Referrer[];
  };
  adopters: {
    external: Adopter[];
    internalCount: number;
    newToday: Adopter[];
    dependentsCount: number | null;
  };
  errors: { source: string; message: string }[];
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const range = (lo: number, hi: number) => `${n(lo)}–${n(hi)}`;

/** The last `count` weeks with all 7 days of data. */
export function lastFullWeeks(weeks: WeekRow[], count: number): WeekRow[] {
  return weeks.filter((w) => w.days === 7).slice(-count);
}

export function renderReport(s: Summary): string {
  const out: string[] = [];
  const day = s.generatedAt.slice(0, 10);
  out.push(`# ${s.package} adoption metrics`, '');
  out.push(
    `Snapshot **${day}** for \`${s.package}\` on npm and \`${s.repo}\` on GitHub. ` +
      'Written daily by `.github/workflows/metrics.yml` on `main`; the raw history is in the JSON files on this branch.',
    '',
  );

  if (s.npm) {
    const e = s.npm.estimate;
    const recent = lastFullWeeks(e.weeks, 4);
    const sum = (pick: (w: WeekRow) => number) => recent.reduce((a, w) => a + pick(w), 0);
    out.push('## npm', '');
    out.push(`Latest \`${s.npm.latest}\` · ${s.npm.versions} versions published since ${s.npm.firstPublished} · data through ${s.npm.lastDay}`, '');
    out.push('| | Downloads |', '| --- | ---: |');
    out.push(`| All time | ${n(e.total)} |`);
    out.push(`| Release windows (publish day and the day after) | ${n(e.release)} |`);
    out.push(`| Registry crawlers on quiet days | ${n(e.crawlers)} |`);
    out.push(`| **Likely real, all time** | **~${n(e.likelyReal)}** (${range(e.likelyRealLow, e.likelyRealHigh)}) |`);
    if (recent.length > 0) {
      out.push(
        `| **Likely real, last ${recent.length} full weeks** | **~${n(sum((w) => w.likelyReal))}** (${range(sum((w) => w.likelyRealLow), sum((w) => w.likelyRealHigh))}) |`,
      );
    }
    out.push('');
    out.push(
      `Crawler rate: ${e.rates.mid.toFixed(2)} downloads per published version per day ` +
        (e.rates.calibrated ? "(calibrated from last week's downloads of superseded versions)." : '(default; no per-version snapshot yet).') +
        ' Likely real downloads are a best-effort estimate, not a count of people.',
      '',
    );
    out.push('### By week', '', '| Week of | Total | Release window | Crawlers | Likely real |', '| --- | ---: | ---: | ---: | ---: |');
    for (const w of e.weeks.slice(-12).reverse()) {
      const partial = w.days < 7 ? ` (${w.days}d)` : '';
      out.push(`| ${w.week}${partial} | ${n(w.total)} | ${n(w.release)} | ${n(w.crawlers)} | ~${n(w.likelyReal)} (${range(w.likelyRealLow, w.likelyRealHigh)}) |`);
    }
    out.push('');
  }

  out.push('## Adopters', '');
  const a = s.adopters;
  if (a.external.length === 0) {
    out.push('No repositories outside our own found yet.', '');
  } else {
    out.push('| Repository | Found in | specproof version | First seen | Last seen |', '| --- | --- | --- | --- | --- |');
    for (const x of a.external) {
      const isNew = a.newToday.some((y) => y.repo === x.repo && y.kind === x.kind && y.path === x.path);
      const where = x.path ? `[${x.path}](${x.url})` : x.kind;
      out.push(`| [${x.repo}](https://github.com/${x.repo})${isNew ? ' **new**' : ''} | ${where} | ${x.version ?? ''} | ${x.firstSeen} | ${x.lastSeen} |`);
    }
    out.push('');
  }
  out.push(
    'Sources: GitHub code search for `specproof` in `package.json` files and in `.github/workflows`, ' +
      `and the dependents graph (${a.dependentsCount === null ? 'unavailable' : `${a.dependentsCount} repositories`}). ` +
      `Public repos only. ${a.internalCount} match${a.internalCount === 1 ? '' : 'es'} in our own repos left out.`,
    '',
  );

  if (s.github || s.traffic) out.push('## GitHub', '');
  if (s.github) {
    const g = s.github;
    out.push('| Stars | Forks | Watchers | Issues open | Issues closed | PRs open | PRs merged | PRs closed unmerged |');
    out.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    out.push(`| ${g.stars} | ${g.forks} | ${g.watchers} | ${g.issuesOpen} | ${g.issuesClosed} | ${g.prsOpen} | ${g.prsMerged} | ${g.prsClosedUnmerged} |`, '');
  }
  if (s.traffic) {
    const t = s.traffic;
    out.push(`Last 14 days: **${n(t.views.count)}** views (${n(t.views.uniques)} unique), **${n(t.clones.count)}** clones (${n(t.clones.uniques)} unique).`, '');
    if (t.referrers.length > 0) {
      out.push('| Referrer | Views | Unique |', '| --- | ---: | ---: |');
      for (const r of t.referrers) out.push(`| ${r.referrer} | ${r.count} | ${r.uniques} |`);
      out.push('');
    }
  }

  if (s.errors.length > 0) {
    out.push('## Sources that failed this run', '');
    for (const err of s.errors) out.push(`- **${err.source}**: ${err.message}`);
    out.push('');
  }
  return out.join('\n');
}
