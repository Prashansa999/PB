import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "S P Photobooth — Take a Photo Together, From Anywhere",
  description:
    "A free realtime online photobooth for long distance couples. Both of you appear in one photo strip, captured at the same second — no app, no download, just a room code.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
