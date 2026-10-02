import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  bucket,
  buildProperties,
  configPath,
  createTelemetry,
  detectCi,
  detectPackageManager,
  proofProperties,
  readConfig,
  repoHash,
  resolveStatus,
  type Runtime,
} from '../../scripts/telemetry';

// Telemetry never touches the network in these tests: every client gets a
// fake fetch that records what it was asked to send.

const tmpDirs: string[] = [];
function tmpConfig(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'specproof-telemetry-'));
  tmpDirs.push(dir);
  return path.join(dir, 'specproof', 'telemetry.json');
}
afterEach(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

function runtime(env: Record<string, string | undefined> = {}): Runtime {
  return { version: '0.9.5', env, platform: 'darwin', arch: 'arm64', nodeVersion: 'v22.3.0' };
}

interface Sent {
  url: string;
  body: { api_key: string; event: string; distinct_id: string; properties: Record<string, unknown> };
}

function client(env: Record<string, string | undefined> = {}, opts: { key?: string; fromSource?: boolean; fail?: boolean } = {}) {
  const sent: Sent[] = [];
  const output: string[] = [];
  const configFile = tmpConfig();
  const telemetry = createTelemetry({
    runtime: runtime(env),
    fromSource: opts.fromSource ?? false,
    key: opts.key ?? 'phc_test',
    host: 'https://ph.example',
    configFile,
    write: (text) => output.push(text),
    fetch: async (url, init) => {
      if (opts.fail) throw new Error('offline');
      sent.push({ url, body: JSON.parse(init.body) });
      return {};
    },
  });
  return { telemetry, sent, output, configFile };
}

describe('resolveStatus', () => {
  it('turns off for each opt-out, most explicit first', () => {
    expect(resolveStatus({ SPECPROOF_TELEMETRY: '0' }, {}, 'k', false)).toEqual({ enabled: false, reason: 'env' });
    expect(resolveStatus({ SPECPROOF_TELEMETRY: 'false' }, { enabled: true }, 'k', false).reason).toBe('env');
    expect(resolveStatus({ DO_NOT_TRACK: '1' }, {}, 'k', false).reason).toBe('do-not-track');
    expect(resolveStatus({}, { enabled: false }, 'k', false).reason).toBe('config');
    expect(resolveStatus({}, {}, '', false).reason).toBe('no-key');
    expect(resolveStatus({}, {}, 'k', true).reason).toBe('source-checkout');
    expect(resolveStatus({}, {}, 'k', false)).toEqual({ enabled: true });
  });

  it('treats DO_NOT_TRACK=0 as not set, and lets SPECPROOF_TELEMETRY=1 run from source', () => {
    expect(resolveStatus({ DO_NOT_TRACK: '0' }, {}, 'k', false).enabled).toBe(true);
    expect(resolveStatus({ SPECPROOF_TELEMETRY: '1' }, {}, 'k', true).enabled).toBe(true);
    // ...but never without a key.
    expect(resolveStatus({ SPECPROOF_TELEMETRY: '1' }, {}, '', true).reason).toBe('no-key');
  });
});

describe('sending', () => {
  it('sends one anonymous PostHog event with a stable install ID', async () => {
    const { telemetry, sent, configFile } = client();
    await telemetry.track({ command: 'generate', flags: ['--check', '--out'], outcome: 'ok', exitCode: 0, durationMs: 812.4 });
    await telemetry.track({ command: 'dev', flags: [], outcome: 'started' });

    expect(sent).toHaveLength(2);
    expect(sent[0].url).toBe('https://ph.example/i/v0/e/');
    expect(sent[0].body).toMatchObject({ api_key: 'phc_test', event: 'command_run' });
    expect(sent[0].body.properties).toMatchObject({
      command: 'generate',
      flags: ['--check', '--out'],
      outcome: 'ok',
      duration_ms: 812,
      specproof_version: '0.9.5',
      node_major: 22,
      os: 'darwin',
      $process_person_profile: false,
    });
    expect(sent[0].body.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[1].body.distinct_id).toBe(sent[0].body.distinct_id);
    expect(readConfig(configFile).installId).toBe(sent[0].body.distinct_id);
  });

  it('sends nothing when disabled, including after `telemetry disable`', async () => {
    const off = client({ SPECPROOF_TELEMETRY: '0' });
    await off.telemetry.track({ command: 'generate', flags: [], outcome: 'ok' });
    expect(off.sent).toHaveLength(0);

    const disabled = client();
    expect(disabled.telemetry.setEnabled(false)).toBe(true);
    await disabled.telemetry.track({ command: 'generate', flags: [], outcome: 'ok' });
    expect(disabled.sent).toHaveLength(0);
    expect(disabled.telemetry.status().reason).toBe('config');
  });

  it('never rejects when the network fails', async () => {
    const { telemetry } = client({}, { fail: true });
    await expect(telemetry.track({ command: 'generate', flags: [], outcome: 'ok' })).resolves.toBeUndefined();
    await expect(telemetry.flush(50)).resolves.toBeUndefined();
  });

  it('stops waiting for a slow send after the flush timeout', async () => {
    const telemetry = createTelemetry({
      runtime: runtime(),
      fromSource: false,
      key: 'k',
      configFile: tmpConfig(),
      fetch: () => new Promise(() => undefined), // never settles
    });
    void telemetry.track({ command: 'start', flags: [], outcome: 'started' });
    const started = Date.now();
    await telemetry.flush(60);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('prints instead of sending in debug mode, even before a key exists', async () => {
    const { telemetry, sent, output } = client({ SPECPROOF_TELEMETRY_DEBUG: '1' }, { key: '' });
    await telemetry.track({ command: 'generate', flags: ['--check'], outcome: 'ok' });
    expect(sent).toHaveLength(0);
    expect(output.join('')).toContain('"command":"generate"');
  });
});

describe('first-run notice', () => {
  it('shows once, then remembers it was shown', () => {
    const { telemetry, output, configFile } = client();
    telemetry.notice();
    telemetry.notice();
    expect(output.join('')).toContain('specproof telemetry disable');
    expect(output).toHaveLength(1);
    expect(readConfig(configFile).noticeShown).toBe(true);
  });

  it('stays quiet when telemetry is off', () => {
    const { telemetry, output } = client({ DO_NOT_TRACK: '1' });
    telemetry.notice();
    expect(output).toHaveLength(0);
  });
});

describe('what an event can contain', () => {
  it('never includes paths, spec names or flag values from the environment', () => {
    const env = {
      SPECPROOF_REPO: '/Users/someone/secret-client-api',
      SPECPROOF_SPEC: 'docs/internal-openapi.yaml',
      SPECPROOF_OUT: '/Users/someone/secret-client-api/proof.json',
      npm_config_user_agent: 'pnpm/9.12.0 npm/? node/v22.3.0 darwin arm64',
    };
    const props = buildProperties(
      { command: 'generate', flags: ['--repo', '--spec', '--out'], outcome: 'ok', proof: { hasSpec: true, operationCount: 12, coveredCount: 30, totalCount: 40, untestedOperations: 2 } },
      { ...runtime(env), remoteUrl: 'git@github.com:acme/secret-client-api.git' },
    );
    const json = JSON.stringify(props);
    expect(json).not.toMatch(/someone|secret|internal|acme|proof\.json|openapi/);
    expect(props).toMatchObject({ package_manager: 'pnpm', operations: '10-49', responses: '10-49', verified_pct: 70 });
  });
});

describe('helpers', () => {
  it('names the package manager from npm_config_user_agent', () => {
    expect(detectPackageManager('bun/1.1.38 npm/? node/v22.0.0 darwin arm64')).toBe('bun');
    expect(detectPackageManager('yarn/1.22.22 npm/? node/v20.0.0 linux x64')).toBe('yarn');
    expect(detectPackageManager('npm/10.8.0 node/v22.3.0 darwin arm64 workspaces/false')).toBe('npm');
    expect(detectPackageManager(undefined)).toBe('unknown');
    expect(detectPackageManager('deno/2.0')).toBe('unknown');
  });

  it('detects CI and the provider', () => {
    expect(detectCi({ GITHUB_ACTIONS: 'true', CI: 'true' })).toEqual({ ci: true, provider: 'github-actions' });
    expect(detectCi({ CI: '1' })).toEqual({ ci: true, provider: null });
    expect(detectCi({ CI: 'false' })).toEqual({ ci: false, provider: null });
    expect(detectCi({})).toEqual({ ci: false, provider: null });
  });

  it('buckets counts', () => {
    expect([0, 1, 9, 10, 49, 50, 199, 200, 999, 1000].map(bucket)).toEqual([
      '0', '1-9', '1-9', '10-49', '10-49', '50-199', '50-199', '200-999', '200-999', '1000+',
    ]);
  });

  it('hashes the same repo the same whichever way its remote is written', () => {
    const h = repoHash('git@github.com:Acme/Api.git');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(repoHash('https://github.com/acme/api')).toBe(h);
    expect(repoHash('https://x-access-token:ghs_abc@github.com/Acme/Api.git')).toBe(h);
    expect(repoHash('ssh://git@github.com:22/acme/api.git')).toBe(h);
    expect(repoHash('https://github.com/acme/web')).not.toBe(h);
    expect(repoHash(undefined)).toBeNull();
  });

  it('rounds verified coverage down to a multiple of 10', () => {
    expect(proofProperties({ totalCount: 3, coveredCount: 3 }).verified_pct).toBe(100);
    expect(proofProperties({ totalCount: 3, coveredCount: 2 }).verified_pct).toBe(60);
    expect(proofProperties({ totalCount: 0, coveredCount: 0 }).verified_pct).toBeNull();
    expect(proofProperties(undefined)).toEqual({});
  });

  it('keeps settings where each platform expects them', () => {
    expect(configPath({}, 'linux', '/home/u')).toBe('/home/u/.config/specproof/telemetry.json');
    expect(configPath({ XDG_CONFIG_HOME: '/cfg' }, 'linux', '/home/u')).toBe('/cfg/specproof/telemetry.json');
    expect(configPath({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'win32', 'C:\\Users\\u')).toContain('specproof');
  });
});
