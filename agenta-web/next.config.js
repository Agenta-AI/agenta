/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,

  async redirects() {
    return [
      {
        source: '/',
        destination: '/apps',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig
