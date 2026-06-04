import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poker Arena — Manual Pilot",
  description: "Play the dev.fun Poker Arena bot manually.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
