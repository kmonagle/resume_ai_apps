import type { ReactNode } from "react";
// Importing a CSS file here applies it to the whole app.
import Link from "next/link";
import "./globals.css";

// NEXT.JS: app/layout.tsx is the "root layout". It wraps EVERY page in the app, so it's where the
// <html> and <body> tags live and where global CSS gets imported. Pages are passed in as `children`.
// It's a Server Component (the default in the App Router): it renders on the server and ships no
// JavaScript of its own to the browser.
//
// Exporting `metadata` is a Next convention that sets the page <title> and description for you.
export const metadata = { title: "RAG Chat", description: "Ask questions across your books" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* next/link does client-side navigation: switching pages doesn't reload the whole app. */}
        <nav className="nav">
          <Link href="/">Chat</Link>
          <Link href="/coach">Habit Coach</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
