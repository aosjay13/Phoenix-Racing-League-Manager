import "./globals.css";
import { AppShell } from "../components/AppShell";
import { AuthProvider } from "../components/AuthProvider";
import { VerifyGate } from "../components/VerifyGate";
import { LeagueProvider } from "../components/LeagueProvider";
import { MySignupsProvider } from "../components/MySignupsProvider";

export const metadata = {
  title: "Phoenix's Racing League Manager",
  description: "Multi-game racing league manager: standings, schedules, results, and driver profiles.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport = {
  themeColor: "#0d0d14",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <VerifyGate>
            <LeagueProvider>
              {/* Inside LeagueProvider: a player's series are league-scoped, so
                  this has to re-ask when the league switches. */}
              <MySignupsProvider>
                <AppShell>{children}</AppShell>
              </MySignupsProvider>
            </LeagueProvider>
          </VerifyGate>
        </AuthProvider>
      </body>
    </html>
  );
}
