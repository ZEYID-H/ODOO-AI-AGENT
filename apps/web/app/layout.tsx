import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted by next/font at build time — no runtime network, no layout
// shift. One UI face for the whole product; numeric alignment comes from
// Inter's tabular-nums feature (see globals.css), not a second font.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Odoo BI Assistant",
  description: "Read-only AI assistant for business analytics and reporting",
};

export const viewport = {
  themeColor: "#101415",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
