import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Odoo BI Assistant",
  description: "Read-only AI assistant for business analytics and reporting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
