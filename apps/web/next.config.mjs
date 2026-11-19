/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { externalDir: true }, // lets us import ../../evidence/deployment.json (single source of truth)
};
export default nextConfig;
