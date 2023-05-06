/** @type {import('next').NextConfig} */
const withSvgr = require('@svgr/webpack');

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,

  webpack(config, options) {
    config.module.rules.push({
      test: /\.svg$/,
      use: [options.defaultLoaders.babel, '@svgr/webpack'],
    });

    return config;
  },
};

module.exports = nextConfig
