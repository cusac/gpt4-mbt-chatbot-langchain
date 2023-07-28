/** @type {import('next').NextConfig} */
import webpack from 'webpack/webpack-lib.js';
import dotenv from 'dotenv';
const localEnv = dotenv.config().parsed;
const nextConfig = {
  reactStrictMode: false,
  swcMinify: true,
  webpack(config) {
    config.plugins.push(new webpack.EnvironmentPlugin(localEnv));
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },
  env: {
    NEXT_PUBLIC_ENV: 'development',
  },
  typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    // !! WARN !!
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
