/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
  // The old standalone admin screens now live as tabs on the pages they belong
  // to, so their former URLs (and any bookmark pointing at one) land on the
  // right tab instead of a 404.
  async redirects() {
    return [
      { source: "/roster", destination: "/drivers?tab=roster", permanent: false },
      { source: "/admin/users", destination: "/drivers?tab=accounts", permanent: false },
      // Race Entry is gone — races are edited from the Schedule.
      { source: "/race-entry", destination: "/schedule", permanent: false },
    ];
  },
};

module.exports = nextConfig;
