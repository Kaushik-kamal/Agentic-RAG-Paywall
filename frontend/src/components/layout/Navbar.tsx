"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Zap, LayoutDashboard, Bot, FileText, Menu, X } from "lucide-react";
import { useState } from "react";

const navLinks = [
  { href: "/",          label: "Home",      icon: <Zap size={16} /> },
  { href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
  { href: "/demo",      label: "AI Demo",   icon: <Bot size={16} /> },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      {/* Backdrop */}
      <div className="absolute inset-0 glass-card border-b border-white/5 backdrop-blur-xl" />

      <nav className="relative max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-sm font-black">
            A
          </span>
          <span className="gradient-text">AgenticRAG</span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  pathname === link.href
                    ? "bg-violet-500/15 text-violet-300 border border-violet-500/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                )}
              >
                {link.icon}
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link href="/demo" className="btn-primary text-sm py-2 px-5">
            Try Demo
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden p-2 text-slate-400 hover:text-white"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden relative glass-card border-t border-white/5 px-6 py-4 flex flex-col gap-2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={clsx(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                pathname === link.href
                  ? "bg-violet-500/15 text-violet-300"
                  : "text-slate-400 hover:text-white hover:bg-white/5"
              )}
            >
              {link.icon}
              {link.label}
            </Link>
          ))}
          <Link href="/demo" className="btn-primary text-sm py-2.5 mt-2">
            Try Demo
          </Link>
        </div>
      )}
    </header>
  );
}
