import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { MessageSquare } from "lucide-react";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Notion Forum",
  description: "A modern forum powered by Notion Headless CMS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <header className="h-14 bg-surface border-b border-border px-6 flex items-center sticky top-0 z-50">
          <div className="flex items-center gap-2 text-accent font-semibold text-lg">
            <MessageSquare size={20} />
            <span>Notion Forum</span>
          </div>
        </header>
        <main className="flex-1 flex flex-col max-w-[1200px] w-full mx-auto p-4 md:p-6">
          {children}
        </main>
      </body>
    </html>
  );
}
