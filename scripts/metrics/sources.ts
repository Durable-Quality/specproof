/**
 * Network fetchers for the metrics run. Each returns plain data and throws on
 * failure; `collect.ts` decides what a failure means for the run.
 */

import { addDays, toDay } from './estimate';
import { parseDependentsPage, trafficToDaily, type DayCount } from './merge';
import type { Referrer, RepoStats } from './report';

const UA = 'specproof-metrics (+https://github.com/Durable-Quality/specproof)';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GET with a few retries on rate limits and server errors. */
async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
    if (res.status !== 429 && res.status < 500) return res;
    await sleep(2000 * 2 ** attempt);
  }
  return res!;
}

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await get(url, headers);
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`${res.status} from ${url}: ${body}`);
  }
  return (await res.json()) as T;
}

// ---- npm ------------------------------------------------------------------

export interface RegistryInfo {
  latest: string;
  /** Version → publish timestamp, for versions still on the registry. */
  published: Record<string, string>;
  created: string;
}

export async function fetchRegistry(pkg: string): Promise<RegistryInfo> {
  const doc = await getJson<{
    'dist-tags': { latest: string };
    versions: Record<string, unknown>;
    time: Record<string, string>;
  }>(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
  const published = Object.fromEntries(Object.keys(doc.versions).filter((v) => doc.time[v]).map((v) => [v, doc.time[v]]));
  return { latest: doc['dist-tags'].latest, published, created: doc.time.created };
}

/** Daily downloads between two UTC days, inclusive. npm caps a range at 18 months. */
export async function fetchDownloads(pkg: string, start: string, end: string): Promise<Record<string, number>> {
  const daily: Record<string, number> = {};
  for (let from = start; from <= end; from = addDays(from, 365)) {
    const to = addDays(from, 364) < end ? addDays(from, 364) : end;
    const res = await getJson<{ downloads: { day: string; downloads: number }[] }>(
      `https://api.npmjs.org/downloads/range/${from}:${to}/${encodeURIComponent(pkg)}`,
    );
    for (const d of res.downloads) daily[d.day] = d.downloads;
  }
  return daily;
}

export async function fetchVersionsLastWeek(pkg: string): Promise<Record<string, number>> {
  const res = await getJson<{ downloads: Record<string, number> }>(`https://api.npmjs.org/versions/${encodeURIComponent(pkg)}/last-week`);
  return res.downloads;
}

/** Yesterday in UTC: npm publishes a day's count once the day is over. */
export function lastCompleteDay(now = Date.now()): string {
  return toDay(now - 86_400_000);
}

// ---- GitHub API -----------------------------------------------------------

function gh(token: string | undefined, accept = 'application/vnd.github+json'): Record<string, string> {
  return {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export interface Traffic {
  views: Record<string, DayCount>;
  clones: Record<string, DayCount>;
  viewsTotal: DayCount;
  clonesTotal: DayCount;
  referrers: Referrer[];
}

/** Needs a token with Administration: read on the repo; GITHUB_TOKEN can't have that. */
export async function fetchTraffic(repo: string, token: string | undefined): Promise<Traffic> {
  if (!token) throw new Error('needs METRICS_TOKEN (a fine-grained token with Administration: read on this repo)');
  const base = `https://api.github.com/repos/${repo}/traffic`;
  type Series = { count: number; uniques: number };
  const views = await getJson<Series & { views: { timestamp: string; count: number; uniques: number }[] }>(`${base}/views?per=day`, gh(token));
  const clones = await getJson<Series & { clones: { timestamp: string; count: number; uniques: number }[] }>(`${base}/clones?per=day`, gh(token));
  const referrers = await getJson<Referrer[]>(`${base}/popular/referrers`, gh(token));
  return {
    views: trafficToDaily(views.views),
    clones: trafficToDaily(clones.clones),
    viewsTotal: { count: views.count, uniques: views.uniques },
    clonesTotal: { count: clones.count, uniques: clones.uniques },
    referrers,
  };
}

async function searchCount(q: string, token: string | undefined): Promise<number> {
  const res = await getJson<{ total_count: number }>(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`, gh(token));
  return res.total_count;
}

/** Stars and friends, with issues and pull requests counted separately. */
export async function fetchRepoStats(repo: string, token: string | undefined): Promise<RepoStats> {
  const r = await getJson<{ stargazers_count: number; forks_count: number; subscribers_count: number }>(
    `https://api.github.com/repos/${repo}`,
    gh(token),
  );
  const q = (rest: string) => searchCount(`repo:${repo} ${rest}`, token);
  return {
    stars: r.stargazers_count,
    forks: r.forks_count,
    watchers: r.subscribers_count,
    issuesOpen: await q('is:issue is:open'),
    issuesClosed: await q('is:issue is:closed'),
    prsOpen: await q('is:pr is:open'),
    prsMerged: await q('is:pr is:merged'),
    prsClosedUnmerged: await q('is:pr is:closed is:unmerged'),
  };
}

export interface CodeHit {
  repo: string;
  path: string;
  url: string;
  fragments: string[];
}

/** GitHub code search over public repos. Code search always needs a token. */
export async function searchCode(query: string, token: string | undefined): Promise<CodeHit[]> {
  if (!token) throw new Error('code search needs a token (METRICS_TOKEN or GITHUB_TOKEN)');
  const hits: CodeHit[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await getJson<{
      items: { path: string; html_url: string; repository: { full_name: string }; text_matches?: { fragment: string }[] }[];
    }>(
      `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=100&page=${page}`,
      gh(token, 'application/vnd.github.text-match+json'),
    );
    for (const item of res.items) {
      hits.push({
        repo: item.repository.full_name,
        path: item.path,
        url: item.html_url,
        fragments: (item.text_matches ?? []).map((m) => m.fragment),
      });
    }
    if (res.items.length < 100) break;
    await sleep(7000); // code search allows 10 requests a minute
  }
  return hits;
}

// ---- GitHub web (no API) --------------------------------------------------

/** Every page of the dependents graph, up to `maxPages`. */
export async function fetchDependents(repo: string, maxPages = 20): Promise<{ count: number | null; repos: string[] }> {
  let url: string | null = `https://github.com/${repo}/network/dependents?dependent_type=REPOSITORY`;
  let count: number | null = null;
  const repos = new Set<string>();
  for (let page = 0; url && page < maxPages; page++) {
    const res = await get(url, { Accept: 'text/html' });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    const parsed = parseDependentsPage(await res.text(), repo);
    count ??= parsed.count;
    parsed.repos.forEach((r) => repos.add(r));
    url = parsed.next;
    if (url) await sleep(1500);
  }
  return { count, repos: [...repos].sort() };
}
