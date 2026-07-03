/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Never cache the main app shell — this was causing stale balance/UI
        // to be served from Vercel's CDN for hours after every deploy.
        source: '/',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
      {
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
    ];
  },
}
module.exports = nextConfig
