import "./globals.css";
import { AppShell } from "../components/AppShell";
import { AuthProvider } from "../components/AuthProvider";
import { LeagueProvider } from "../components/LeagueProvider";

export const metadata = {
  title: "Phoenix Racing League Manager",
  description: "Multi-game racing league manager: standings, schedules, results, and driver profiles.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <LeagueProvider>
            <AppShell>{children}</AppShell>
          </LeagueProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
