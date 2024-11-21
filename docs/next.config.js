module.exports = {
  async redirects() {
    return [
      {
        source: '/about',
        destination: '/',
        permanent: false,
      },      
      {
        source: '/prompt-management/creating-a-custom-template',
        destination: '/custom-workflows/quick-start',
        permanent: false,
      },
    ]
  },
}