import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Process monitor",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="bg-white text-zinc-900">{children}</body>
    </html>
  );
}
