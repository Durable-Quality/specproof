/**
 * Daily adoption-metrics run: pulls what npm and GitHub show publicly about
 * SpecProof's use, merges it into the history saved by earlier runs, and
 * rewrites a readable summary.
 *
 *   bun scripts/metrics/collect.ts --data metrics-data
 *
 * `--data` is a checkout of the `metrics` branch (the workflow sets that up;
 * locally, any scratch directory works, and `metrics-data/` is gitignored).
 * Layout:
 *
 *   README.md                    this run's summary, rendered by report.ts
 *   summary.json                 the same, as data
 *   adopters.json                repos found using specproof, with first/last seen
 *   npm/downloads.json           downloads per day, full history
 *   npm/releases.json            version → publish time
 *   npm/versions-last-week.json  run day → npm's per-version counts for the last week
 *   github/repo.json             run day → stars, forks, watchers, issues and PRs
 *   github/views.json            day → views (GitHub keeps only 14 days)
 *   github/clones.json           day → clones
 *   github/referrers.json        run day → top referrers over the previous 14 days
 *
 * Env: METRICS_TOKEN (fine-grained, Administration: read, needed for traffic)
 * and GITHUB_TOKEN (enough for everything else). METRICS_INTERNAL_OWNERS is a
 * comma-separated list of GitHub owners whose repos don't count as adopters;
 * the repo's own owner is always on it.
 *
 * Each source fails on its own: the run records the error in the summary and
 * carries on, and only exits non-zero when nothing at all could be fetched.
 */

import fs from 'node:fs';
import path from 'node:path';

import { estimateRealDownloads, toDay } from './estimate';
import { isInternal, mergeAdopters, mergeDaily, parseSpecproofDependency, type Adopter, type AdopterFind, type DayCount } from './merge';
import { renderReport, type RepoStats, type Summary } from './report';
import {
  fetchDependents,
  fetchDownloads,
  fetchRegistry,
  fetchRepoStats,
  fetchTraffic,
  fetchVersionsLastWeek,
  lastCompleteDay,
  searchCode,
} from './sources';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataDir = path.resolve(arg('--data', path.join(ROOT, 'metrics-data')));

function readJson<T>(rel: string, fallback: T): T {
  const file = path.join(dataDir, rel);
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback;
}

function writeJson(rel: string, data: unknown): void {
  const file = path.join(dataDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function main(): Promise<void> {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { name: string; repository: string };
  const pkg = manifest.name;
  const repo = process.env.GITHUB_REPOSITORY || manifest.repository.replace(/^github:/, '');
  const metricsToken = process.env.METRICS_TOKEN || undefined;
  const token = metricsToken ?? (process.env.GITHUB_TOKEN || undefined);
  const internalOwners = [repo.split('/')[0], ...(process.env.METRICS_INTERNAL_OWNERS ?? '').split(',')].map((o) => o.trim()).filter(Boolean);
  const now = new Date();
  const today = toDay(now.getTime());

  const errors: Summary['errors'] = [];
  let succeeded = 0;
  async function attempt<T>(source: string, run: () => Promise<T>): Promise<T | undefined> {
    try {
      const value = await run();
      succeeded++;
      return value;
    } catch (err) {
      errors.push({ source, message: err instanceof Error ? err.message : String(err) });
      return undefined;
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const summary: Summary = {
    generatedAt: now.toISOString(),
    package: pkg,
    repo,
    adopters: { external: [], internalCount: 0, newToday: [], dependentsCount: null },
    errors,
  };

  // npm: downloads per day, and per version for the last week.
  const registry = await attempt('npm registry', () => fetchRegistry(pkg));
  if (registry) {
    writeJson('npm/releases.json', registry.published);
    const end = lastCompleteDay(now.getTime());
    const fresh = await attempt('npm downloads', () => fetchDownloads(pkg, registry.created.slice(0, 10), end));
    const daily = mergeDaily(readJson<Record<string, number>>('npm/downloads.json', {}), fresh ?? {});
    writeJson('npm/downloads.json', daily);

    type Snapshot = { latest: string; downloads: Record<string, number> };
    const snapshots = readJson<Record<string, Snapshot>>('npm/versions-last-week.json', {});
    const lastWeek = await attempt('npm per-version downloads', () => fetchVersionsLastWeek(pkg));
    if (lastWeek) snapshots[today] = { latest: registry.latest, downloads: lastWeek };
    writeJson('npm/versions-last-week.json', mergeDaily(snapshots, {}));

    const snapshotDay = Object.keys(snapshots).sort().pop();
    const snapshot = snapshotDay ? snapshots[snapshotDay] : undefined;
    const days = Object.keys(daily);
    if (days.length > 0) {
      summary.npm = {
        latest: registry.latest,
        versions: Object.keys(registry.published).length,
        firstPublished: registry.created.slice(0, 10),
        lastDay: days.sort()[days.length - 1],
        estimate: estimateRealDownloads({
          daily,
          published: registry.published,
          lastWeekByVersion: snapshot?.downloads,
          latest: snapshot?.latest,
          snapshotDay,
        }),
      };
    }
  }

  // GitHub: repo stats every run, so stars and issues get a history too.
  const stats = await attempt('GitHub repo stats', () => fetchRepoStats(repo, token));
  if (stats) {
    summary.github = stats;
    writeJson('github/repo.json', mergeDaily(readJson<Record<string, RepoStats>>('github/repo.json', {}), { [today]: stats }));
  }

  // GitHub traffic: deleted after 14 days, so this is the only copy that lasts.
  const traffic = await attempt('GitHub traffic', () => fetchTraffic(repo, metricsToken));
  if (traffic) {
    writeJson('github/views.json', mergeDaily(readJson<Record<string, DayCount>>('github/views.json', {}), traffic.views));
    writeJson('github/clones.json', mergeDaily(readJson<Record<string, DayCount>>('github/clones.json', {}), traffic.clones));
    writeJson('github/referrers.json', mergeDaily(readJson('github/referrers.json', {}), { [today]: traffic.referrers }));
    summary.traffic = { views: traffic.viewsTotal, clones: traffic.clonesTotal, referrers: traffic.referrers };
  }

  // Adopters: public repos that declare specproof, run it in CI, or show up as dependents.
  const finds: AdopterFind[] = [];
  const internal = (r: string) => isInternal(r, internalOwners);
  const manifests = await attempt('code search: package.json', () => searchCode(`${pkg} filename:package.json`, token));
  for (const hit of manifests ?? []) {
    const version = hit.fragments.map(parseSpecproofDependency).find(Boolean);
    // A package.json that only mentions the word (a description, a script) isn't a dependency.
    if (!version) continue;
    finds.push({ kind: 'package.json', repo: hit.repo, path: hit.path, url: hit.url, version, internal: internal(hit.repo) });
  }
  const workflows = await attempt('code search: workflows', () => searchCode(`${pkg} path:.github/workflows`, token));
  for (const hit of workflows ?? []) {
    finds.push({ kind: 'workflow', repo: hit.repo, path: hit.path, url: hit.url, internal: internal(hit.repo) });
  }
  const dependents = await attempt('dependents graph', () => fetchDependents(repo));
  for (const r of dependents?.repos ?? []) {
    finds.push({ kind: 'dependents', repo: r, path: '', url: `https://github.com/${r}`, internal: internal(r) });
  }
  const adopters = mergeAdopters(readJson<Adopter[]>('adopters.json', []), finds, today).map((a) => ({ ...a, internal: internal(a.repo) }));
  writeJson('adopters.json', adopters);
  const external = adopters.filter((a) => !a.internal);
  summary.adopters = {
    external,
    internalCount: adopters.length - external.length,
    newToday: external.filter((a) => a.firstSeen === today),
    dependentsCount: dependents?.count ?? null,
  };

  writeJson('summary.json', summary);
  const report = renderReport(summary);
  fs.writeFileSync(path.join(dataDir, 'README.md'), report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);

  for (const e of errors) {
    console.warn(process.env.GITHUB_ACTIONS ? `::warning title=${e.source}::${e.message}` : `warning: ${e.source}: ${e.message}`);
  }
  console.log(`metrics: ${succeeded} sources ok, ${errors.length} failed → ${path.relative(process.cwd(), dataDir) || '.'}`);
  if (succeeded === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
