import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSentryProductionEnabled,
  resolveSentryDsn,
  SENTRY_DSN_FALLBACK,
} from "../../lib/sentry-config";

describe("sentry-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses fallback DSN when env is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", undefined);
    vi.stubEnv("SENTRY_DSN", undefined);
    expect(resolveSentryDsn()).toBe(SENTRY_DSN_FALLBACK);
  });

  it("opts out when DSN env is empty string", () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    expect(resolveSentryDsn()).toBeUndefined();
  });

  it("prefers explicit env over fallback", () => {
    vi.stubEnv("SENTRY_DSN", "https://example@o1.ingest.sentry.io/1");
    expect(resolveSentryDsn()).toBe("https://example@o1.ingest.sentry.io/1");
  });

  it("does not enable outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", undefined);
    expect(isSentryProductionEnabled()).toBe(false);
  });

  it("enables on Vercel production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NODE_ENV", "production");
    expect(isSentryProductionEnabled()).toBe(true);
  });
});
