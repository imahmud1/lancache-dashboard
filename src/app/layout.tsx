import type { Metadata } from "next";
import { Inter, Archivo } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Variable width axis: figures are set condensed (see the `figure` utility).
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo" });

export const metadata: Metadata = {
  title: "LanCache Dashboard",
  description: "Real-time monitoring dashboard for LanCache",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${archivo.variable}`}>
      <body className="font-sans bg-ground text-ink antialiased">{children}</body>
    </html>
  );
}
