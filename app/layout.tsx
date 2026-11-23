import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { UserMenu } from "@/components/auth/user-menu";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Equipo de agentes · Orquestador, Develop y Testing",
  description:
    "Tres agentes de IA que trabajan juntos: el Orquestador divide la petición en tareas, Develop las implementa y Testing las comprueba hasta que todo pasa.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <header className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold text-zinc-900">
              <span className="flex -space-x-1.5" aria-hidden>
                <span className="size-4 rounded-full bg-violet-500 ring-2 ring-white" />
                <span className="size-4 rounded-full bg-sky-500 ring-2 ring-white" />
                <span className="size-4 rounded-full bg-emerald-500 ring-2 ring-white" />
              </span>
              Equipo de agentes
            </Link>
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
