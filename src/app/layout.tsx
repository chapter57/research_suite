import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Research Suite",
  description: "Write, record your process, and reflect on how your ideas took shape.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
