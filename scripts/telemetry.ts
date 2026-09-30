// Anonymous usage telemetry for the published CLI.
//
// One event per command, sent to PostHog, so we can tell how many people use
// SpecProof and how, which npm's download counts can't. What an event holds
// is exactly what `buildProperties` returns; README.md ("Telemetry") lists it
// for users, and SPECPROOF_TELEMETRY_DEBUG=1 prints it instead of sending.
//
// Rules this module keeps:
// - Never slows or breaks the CLI: every failure is swallowed, and the CLI
//   waits at most FLUSH_TIMEOUT_MS for a send before exiting.
// - No paths, file contents, repo or package names, or anything a user typed
//   as a value. Flags are recorded by name only, sizes as buckets, and the
//   repo as a salted hash of its git remote.
// - Off when SPECPROOF_TELEMETRY=0, DO_NOT_TRACK=1, after
//   `specproof telemetry disable`, when running from a source checkout (this
//   repo's own dev loop), and whenever POSTHOG_KEY is empty.
//
// Compiled into dist/ with the CLI (tsconfig.cli.json), so Node built-ins only.

import { spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * PostHog project API key. Safe to publish: PostHog's capture endpoint is
 * write-only and returns no project data. Empty means telemetry is off.
 */
export const POSTHOG_KEY = 'phc_xMU9yCDXrsotAk9jjwihLPErwBwjunNZ3eBsKxDFAPMj';
/** EU cloud. Use https://us.i.posthog.com if the project lives in the US region. */
export const POSTHOG_HOST = 'https://eu.i.posthog.com';

export const FLUSH_TIMEOUT_MS = 1000;
const SEND_TIMEOUT_MS = 3000;

export const DOCS_URL = 'https://github.com/Durable-Quality/specproof#telemetry';

export const NOTICE = `specproof: sends anonymous usage data (command, version, OS, CI, rough spec size) to help us decide what to build next.
  No code, paths, spec contents or repo names. Details: ${DOCS_URL}
  Turn it off: specproof telemetry disable, or set SPECPROOF_TELEMETRY=0
`;

type Env = Record<string, string | undefined>;

export interface TelemetryConfig {
  installId?: string;
  /** False after `specproof telemetry disable`. */
  enabled?: boolean;
  noticeShown?: boolean;
}

export type DisabledReason = 'env' | 'do-not-track' | 'config' | 'no-key' | 'source-checkout';

export interface TelemetryStatus {
  enabled: boolean;
  reason?: DisabledReason;
}

const OFF = new Set(['0', 'false', 'off', 'no']);
const ON = new Set(['1', 'true', 'on', 'yes']);
const flag = (value: string | undefined) => (value ?? '').trim().toLowerCase();

/** Where the install ID and on/off choice live, per the platform's config convention. */
export function configPath(env: Env = process.env, platform: string = process.platform, home: string = os.homedir()): string {
  if (env.SPECPROOF_TELEMETRY_CONFIG) return env.SPECPROOF_TELEMETRY_CONFIG;
  const base =
    platform === 'win32'
      ? (env.APPDATA ?? path.join(home, 'AppData', 'Roaming'))
      : (env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
  return path.join(base, 'specproof', 'telemetry.json');
}

export function readConfig(file: string): TelemetryConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as TelemetryConfig) : {};
  } catch {
    return {};
  }
}

/** Best effort: a read-only home just means a fresh install ID per run. */
export function writeConfig(file: string, config: TelemetryConfig): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** First reason that turns telemetry off, most explicit first. */
export function resolveStatus(env: Env, config: TelemetryConfig, key: string, fromSource: boolean): TelemetryStatus {
  const setting = flag(env.SPECPROOF_TELEMETRY);
  if (OFF.has(setting)) return { enabled: false, reason: 'env' };
  const dnt = flag(env.DO_NOT_TRACK);
  if (dnt !== '' && !OFF.has(dnt)) return { enabled: false, reason: 'do-not-track' };
  if (config.enabled === false) return { enabled: false, reason: 'config' };
  if (!key) return { enabled: false, reason: 'no-key' };
  // This repo's own dev loop runs the CLI from source; its usage isn't adoption.
  if (fromSource && !ON.has(setting)) return { enabled: false, reason: 'source-checkout' };
  return { enabled: true };
}

export function describeStatus(status: TelemetryStatus): string {
  if (status.enabled) return 'enabled';
  switch (status.reason) {
    case 'env':
      return 'disabled by SPECPROOF_TELEMETRY';
    case 'do-not-track':
      return 'disabled by DO_NOT_TRACK';
    case 'config':
      return 'disabled (specproof telemetry disable)';
    case 'no-key':
      return 'disabled (this build has no telemetry key)';
    case 'source-checkout':
      return 'disabled (running from a source checkout)';
    default:
      return 'disabled';
  }
}

/** `npm_config_user_agent` → the package manager that launched us. */
export function detectPackageManager(userAgent: string | undefined): string {
  const name = (userAgent ?? '').split('/')[0]?.trim().toLowerCase();
  return name && ['npm', 'pnpm', 'yarn', 'bun'].includes(name) ? name : 'unknown';
}

const CI_PROVIDERS: [string, string][] = [
  ['GITHUB_ACTIONS', 'github-actions'],
  ['GITLAB_CI', 'gitlab'],
  ['CIRCLECI', 'circleci'],
  ['BUILDKITE', 'buildkite'],
  ['JENKINS_URL', 'jenkins'],
  ['TF_BUILD', 'azure-pipelines'],
  ['BITBUCKET_BUILD_NUMBER', 'bitbucket'],
  ['CODEBUILD_BUILD_ID', 'aws-codebuild'],
  ['TRAVIS', 'travis'],
  ['VERCEL', 'vercel'],
  ['NETLIFY', 'netlify'],
];

export function detectCi(env: Env): { ci: boolean; provider: string | null } {
  const provider = CI_PROVIDERS.find(([name]) => env[name])?.[1] ?? null;
  const ci = provider !== null || (flag(env.CI) !== '' && !OFF.has(flag(env.CI)));
  return { ci, provider };
}

/** Counts as coarse ranges, so a spec's size never fingerprints it. */
export function bucket(n: number): string {
  if (n <= 0) return '0';
  if (n < 10) return '1-9';
  if (n < 50) return '10-49';
  if (n < 200) return '50-199';
  if (n < 1000) return '200-999';
  return '1000+';
}

/**
 * The same repo hashes the same whether its remote is written as SSH or
 * HTTPS, with or without credentials or `.git`. Salted, so the hash isn't a
 * plain digest of the URL.
 */
export function repoHash(remoteUrl: string | undefined): string | null {
  if (!remoteUrl?.trim()) return null;
  const normalized = remoteUrl
    .trim()
    .replace(/^[a-z+]+:\/\//i, '') // protocol
    .replace(/^[^@/]+@/, '') // user[:token]@
    .replace(/^([^/:]+):(?!\d+\/)/, '$1/') // scp-style host:owner/repo
    .replace(/:\d+\//, '/') // explicit port
    .replace(/\.git\/?$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  return createHash('sha256').update(`specproof:${normalized}`).digest('hex').slice(0, 16);
}

export function readGitRemote(repoRoot: string): string | undefined {
  try {
    const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return result.status === 0 ? result.stdout.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** The fields of a CoverageReport that telemetry reads (kept structural so no value import is needed). */
export interface ProofShape {
  hasSpec?: boolean;
  operationCount?: number;
  coveredCount?: number;
  totalCount?: number;
  untestedOperations?: number;
}

export function readProof(file: string): ProofShape | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ProofShape;
  } catch {
    return undefined;
  }
}

export function proofProperties(proof: ProofShape | undefined): Record<string, unknown> {
  if (!proof) return {};
  const total = proof.totalCount ?? 0;
  return {
    has_spec: proof.hasSpec ?? null,
    operations: bucket(proof.operationCount ?? 0),
    responses: bucket(total),
    untested_operations: bucket(proof.untestedOperations ?? 0),
    // Rounded down to a multiple of 10, so 100 means everything is proven.
    verified_pct: total > 0 ? Math.floor(((proof.coveredCount ?? 0) / total) * 10) * 10 : null,
  };
}

export interface CommandRun {
  command: string;
  /** Flag names only, never their values. */
  flags: string[];
  outcome: 'ok' | 'error' | 'started';
  exitCode?: number;
  durationMs?: number;
  proof?: ProofShape;
}

export interface Runtime {
  version: string;
  env: Env;
  platform: string;
  arch: string;
  nodeVersion: string;
  remoteUrl?: string;
}

export function buildProperties(run: CommandRun, rt: Runtime): Record<string, unknown> {
  const { ci, provider } = detectCi(rt.env);
  return {
    command: run.command,
    flags: [...new Set(run.flags)].sort(),
    outcome: run.outcome,
    exit_code: run.exitCode ?? null,
    duration_ms: run.durationMs === undefined ? null : Math.round(run.durationMs),
    specproof_version: rt.version,
    node_major: Number(rt.nodeVersion.replace(/^v/, '').split('.')[0]) || null,
    os: rt.platform,
    arch: rt.arch,
    package_manager: detectPackageManager(rt.env.npm_config_user_agent),
    ci,
    ci_provider: provider,
    repo_hash: repoHash(rt.remoteUrl),
    ...proofProperties(run.proof),
    // Anonymous event: no person profile is created for the install ID.
    $process_person_profile: false,
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<unknown>;

export interface TelemetryOptions {
  runtime: Runtime;
  fromSource: boolean;
  key?: string;
  host?: string;
  fetch?: FetchLike;
  write?: (text: string) => void;
  configFile?: string;
  /** The audited repo, for its git remote; read only when an event is actually built. */
  repoRoot?: () => string;
}

export interface Telemetry {
  status(): TelemetryStatus;
  /** Prints the one-time notice if telemetry is on and it hasn't been shown. */
  notice(): void;
  /** Never rejects. */
  track(run: CommandRun): Promise<void>;
  /** Waits for pending sends, but never longer than `timeoutMs`. */
  flush(timeoutMs?: number): Promise<void>;
  setEnabled(enabled: boolean): boolean;
  configFile: string;
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const rt = options.runtime;
  const key = options.key ?? POSTHOG_KEY;
  const host = options.host ?? POSTHOG_HOST;
  const write = options.write ?? ((text: string) => process.stderr.write(text));
  const doFetch: FetchLike | undefined =
    options.fetch ?? (typeof fetch === 'function' ? (fetch as unknown as FetchLike) : undefined);
  const file = options.configFile ?? configPath(rt.env);
  let config = readConfig(file);
  const pending = new Set<Promise<void>>();

  const status = () => resolveStatus(rt.env, config, key, options.fromSource);
  const debug = ON.has(flag(rt.env.SPECPROOF_TELEMETRY_DEBUG));

  function installId(): string {
    if (!config.installId) {
      config = { ...config, installId: randomUUID() };
      writeConfig(file, config);
    }
    return config.installId!;
  }

  async function send(run: CommandRun): Promise<void> {
    if (rt.remoteUrl === undefined && options.repoRoot) rt.remoteUrl = readGitRemote(options.repoRoot()) ?? '';
    const body = {
      api_key: key,
      event: 'command_run',
      distinct_id: installId(),
      properties: buildProperties(run, rt),
      timestamp: new Date().toISOString(),
    };
    if (debug) {
      write(`specproof telemetry (debug, not sent): ${JSON.stringify(body.properties)}\n`);
      return;
    }
    if (!doFetch) return;
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = setTimeout(() => controller?.abort(), SEND_TIMEOUT_MS);
    // Don't let a slow send hold a finished CLI open.
    (timer as { unref?: () => void }).unref?.();
    try {
      await doFetch(`${host}/i/v0/e/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    configFile: file,
    status,
    notice() {
      // Debug mode prints events even from a source checkout, so the notice
      // is only about real sends.
      if (!status().enabled || config.noticeShown) return;
      write(NOTICE);
      config = { ...config, noticeShown: true };
      writeConfig(file, config);
    },
    track(run) {
      const s = status();
      // Debug prints locally, so it also works before the key exists and from
      // a source checkout. An explicit opt-out still silences it.
      const on = s.enabled || (debug && (s.reason === 'no-key' || s.reason === 'source-checkout'));
      if (!on) return Promise.resolve();
      const p = send(run).catch(() => undefined);
      pending.add(p);
      void p.finally(() => pending.delete(p));
      return p;
    },
    async flush(timeoutMs = FLUSH_TIMEOUT_MS) {
      if (pending.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      });
      await Promise.race([Promise.all(pending).then(() => undefined), timeout]);
      clearTimeout(timer);
    },
    setEnabled(enabled) {
      config = { ...config, enabled };
      return writeConfig(file, config);
    },
  };
}
