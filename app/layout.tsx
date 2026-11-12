import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hivemind",
  description: "Give one goal to a team of AI agents and watch them plan, call tools and answer, live in 3D.",
};

export const viewport: Viewport = { themeColor: "#EEF0F5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
