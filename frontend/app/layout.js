import "./globals.css";
import { AppShell } from "../components/AppShell";

export const metadata = {
  title: "Apex League Control",
  description: "Racing league manager with live standings and race operations.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
