/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // The app is built from source even when installed under node_modules
  // (`specproof dev`/`build`); without this, Next's loaders skip its files.
  transpilePackages: ['specproof'],
};

export default nextConfig;
