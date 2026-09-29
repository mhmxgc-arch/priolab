import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Priolab | ניתוח רווח והפסד",
  description: "מערכת מאובטחת לניתוח דוחות רווח והפסד",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
