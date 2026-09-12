import path from 'path';
import { fileURLToPath } from 'url';

// This file always sits at the package root, whether SpecProof is running from
// its own checkout or from a consumer's node_modules. `next dev <pkgDir>` runs
// with the consumer's repo as the working directory, so cwd is no guide to
// where the app's bundled proof lives — this is.
const packageRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // The app is built from source even when installed under node_modules
  // (`specproof dev`/`build`); without this, Next's loaders skip its files.
  transpilePackages: ['specproof'],
  // Read by the apply route, which refreshes the bundled artifact after
  // writing a test so the audit view reflects it without waiting on a watcher
  // that only `specproof dev` starts.
  env: { SPECPROOF_APP_ROOT: packageRoot },
};

export default nextConfig;
