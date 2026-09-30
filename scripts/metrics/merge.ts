/**
 * Pure helpers for keeping metrics history across daily runs. GitHub only
 * keeps 14 days of traffic and npm's per-version counts only cover the last
 * week, so each run merges what it fetched into what earlier runs saved.
 */

export interface DayCount {
  count: number;
  uniques: number;
}

/** Newer values win: a day fetched again later is more complete than before. */
export function mergeDaily<T>(existing: Record<string, T>, incoming: Record<string, T>): Record<string, T> {
  const merged: Record<string, T> = { ...existing, ...incoming };
  return Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
}

/** GitHub traffic (`views` or `clones`, per=day) → YYYY-MM-DD → counts. */
export function trafficToDaily(entries: { timestamp: string; count: number; uniques: number }[]): Record<string, DayCount> {
  return Object.fromEntries(entries.map((e) => [e.timestamp.slice(0, 10), { count: e.count, uniques: e.uniques }]));
}

export type AdopterKind = 'package.json' | 'workflow' | 'dependents';

export interface AdopterFind {
  kind: AdopterKind;
  /** owner/name */
  repo: string;
  /** File the match was in; empty for the dependents graph. */
  path: string;
  url: string;
  /** Declared specproof version range, when the match was a package.json. */
  version?: string;
  /** Owner is us, so it says nothing about adoption. */
  internal: boolean;
}

export interface Adopter extends AdopterFind {
  firstSeen: string;
  lastSeen: string;
}

const adopterKey = (a: AdopterFind) => `${a.kind}:${a.repo.toLowerCase()}:${a.path}`;

/**
 * Adds today's finds to the running list. Repos that stop showing up keep
 * their old `lastSeen` rather than disappearing, so churn stays visible.
 */
export function mergeAdopters(existing: Adopter[], found: AdopterFind[], today: string): Adopter[] {
  const byKey = new Map(existing.map((a) => [adopterKey(a), a]));
  for (const f of found) {
    const prev = byKey.get(adopterKey(f));
    byKey.set(adopterKey(f), { ...f, firstSeen: prev?.firstSeen ?? today, lastSeen: today });
  }
  return [...byKey.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path));
}

export function isInternal(repo: string, internalOwners: string[]): boolean {
  const owner = repo.split('/')[0]?.toLowerCase();
  return internalOwners.some((o) => o.toLowerCase() === owner);
}

/** `"specproof": "^0.9.4"` in a code-search text fragment → `^0.9.4`. */
export function parseSpecproofDependency(fragment: string): string | undefined {
  return /"specproof"\s*:\s*"([^"]+)"/.exec(fragment)?.[1];
}

export interface DependentsPage {
  /** Repositories GitHub says depend on us; null when the page didn't say. */
  count: number | null;
  repos: string[];
  /** URL of the next page, if there is one. */
  next: string | null;
}

/**
 * Reads the repository dependents page
 * (`/<owner>/<repo>/network/dependents`), which has no API. Throws when the
 * page looks nothing like it used to, so a GitHub redesign shows up as an
 * error in the report instead of a quiet zero.
 */
export function parseDependentsPage(html: string, selfRepo: string): DependentsPage {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const counted = /([\d,]+) Repositor(?:y|ies)\b/.exec(text);
  const none = /haven[’']t found any dependents/i.test(text);
  if (!counted && !none) {
    throw new Error('dependents page not recognised: no "N Repositories" count and no empty-state message');
  }

  const repos = new Set<string>();
  for (const tag of html.match(/<a\b[^>]*data-hovercard-type="repository"[^>]*>/g) ?? []) {
    const href = /href="\/([^"/?#]+\/[^"/?#]+)"/.exec(tag)?.[1];
    if (href && href.toLowerCase() !== selfRepo.toLowerCase()) repos.add(href);
  }

  let next: string | null = null;
  for (const m of html.matchAll(/<a\b([^>]*)>\s*Next\s*<\/a>/g)) {
    const href = /href="([^"]*dependents_after=[^"]*)"/.exec(m[1])?.[1];
    if (href) next = href.replace(/&amp;/g, '&');
  }

  return { count: none ? 0 : Number(counted![1].replace(/,/g, '')), repos: [...repos].sort(), next };
}
