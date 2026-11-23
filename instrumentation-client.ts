import * as Sentry from "@sentry/nextjs";
import { baseSentryInitOptions } from "./lib/sentry-config";

const { dsn, enabled, environment, release, tracesSampleRate } =
  baseSentryInitOptions();

Sentry.init({
  dsn,
  enabled,
  environment,
  release,
  tracesSampleRate,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
