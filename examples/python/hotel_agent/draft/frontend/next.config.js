/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow the dev server's /_next/* assets to load when the page is opened
  // from a remote origin (we're often hitting this box by its public IP).
  allowedDevOrigins: ["144.76.237.122"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
