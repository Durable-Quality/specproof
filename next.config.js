import { withSentryConfig } from "@sentry/nextjs/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // The app is built from source even when installed under node_modules
  // (`specproof dev`/`build`); without this, Next's loaders skip its files.
  transpilePackages: ["specproof"],
};

const sentryOrg = process.env.SENTRY_ORG ?? "durable-quality";
const sentryProject = process.env.SENTRY_PROJECT ?? "specproof";
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

export default withSentryConfig(nextConfig, {
  org: sentryOrg,
  project: sentryProject,
  authToken: sentryAuthToken,
  silent: !process.env.CI,
  sourcemaps: {
    disable: !sentryAuthToken,
  },
});
