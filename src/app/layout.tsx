import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Image to SVG — Конвертер иконок и favicon",
  description: "Конвертируйте PNG/JPEG изображения в редактируемый SVG с удалением фона и генерацией favicon.",
  keywords: ["SVG", "icon converter", "PNG to SVG", "JPEG to SVG", "favicon generator", "background removal", "vectorization"],
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Image to SVG Converter",
    description: "Convert PNG/JPEG images to editable SVG with background removal and favicon generation",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
