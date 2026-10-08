import type { Metadata } from "next";
import "./globals.css";
import "./company/company.css";
import "./components/dashboard-ui.css";
import Session from "./company/session";

export const metadata: Metadata = {
  title: "会社ダッシュボード",
  description: "Agent control plane for workspace, metrics, and production jobs"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body><Session>{children}</Session></body>
    </html>
  );
}
