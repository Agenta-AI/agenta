module.exports = {
  async redirects() {
    return [
      {
        source: '/about',
        destination: '/',
        permanent: false,
      },
    ]
  },
}