/** Public ingest DSN for the hosted specproofoss.vercel.app deployment (EU). */
export const SENTRY_DSN_FALLBACK =
  "https://7ddd427a70de31d99d8309525e90936a@o4510091891769344.ingest.de.sentry.io/4512351983239248";

/**
 * Resolve DSN from env, with a fallback for the official Vercel deployment.
 * Set `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN` to an empty string to opt out
 * (self-hosted production builds that should not report anywhere).
 */
export function resolveSentryDsn(): string | undefined {
  const fromEnv =
    process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
  if (fromEnv === "") return undefined;
  if (fromEnv) return fromEnv;
  return SENTRY_DSN_FALLBACK;
}

/** Send events only in production (Vercel or plain NODE_ENV). */
export function isSentryProductionEnabled(): boolean {
  if (!resolveSentryDsn()) return false;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === "production";
  return process.env.NODE_ENV === "production";
}

export function sentryEnvironment(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
}

export function sentryRelease(): string | undefined {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha && sha.length > 0 ? sha : undefined;
}

/** Shared options for client, server, and edge Sentry.init calls. */
export function baseSentryInitOptions(): {
  dsn: string | undefined;
  enabled: boolean;
  environment: string;
  release?: string;
  tracesSampleRate: number;
} {
  const dsn = resolveSentryDsn();
  const enabled = isSentryProductionEnabled();
  return {
    dsn,
    enabled,
    environment: sentryEnvironment(),
    release: sentryRelease(),
    tracesSampleRate: enabled ? 0.2 : 0,
  };
}
