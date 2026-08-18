/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin"],
  },
  // Old URLs land where the screen actually lives now, rather than on a 404.
  async redirects() {
    return [
      // The roster went the other way: it was a standalone /roster screen, then
      // a tab on Drivers, and it's a menu of its own again (Admin ▸ Driver
      // Roster). /roster is therefore a real page once more — what redirects
      // now is the tab URL that replaced it, so bookmarks from either era work.
      //
      // This is a SERVER redirect on purpose. The client-side equivalent raced
      // LeagueProvider, which mirrors the scope selection into the address bar
      // with history.replaceState and would put ?tab=roster straight back.
      {
        source: "/drivers",
        has: [{ type: "query", key: "tab", value: "roster" }],
        destination: "/roster",
        permanent: false,
      },
      // User Accounts went the same way, and for the same reason: it is a job
      // rather than a view, so it is Admin ▸ User Accounts (/accounts) instead
      // of a tab. Both the old tab URL and the older standalone screen land
      // there. Server-side for the same reason as the roster redirect above.
      {
        source: "/drivers",
        has: [{ type: "query", key: "tab", value: "accounts" }],
        destination: "/accounts",
        permanent: false,
      },
      { source: "/admin/users", destination: "/accounts", permanent: false },
      // Race Entry is gone — races are edited from the Schedule.
      { source: "/race-entry", destination: "/schedule", permanent: false },
    ];
  },
};

module.exports = nextConfig;
