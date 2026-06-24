"use client";

import Link from "next/link";
import { Zap, Code2, MessageCircle } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative border-t border-white/5 mt-24">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {/* Brand */}
          <div>
            <Link href="/" className="flex items-center gap-2 font-bold text-base mb-3">
              <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs font-black">
                A
              </span>
              <span className="gradient-text">AgenticRAG Paywall</span>
            </Link>
            <p className="text-slate-500 text-sm leading-relaxed">
              AI agents pay Stellar micropayments to access a LangChain + Gemini knowledge API.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Platform</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              <li><Link href="/" className="hover:text-violet-400 transition-colors">Home</Link></li>
              <li><Link href="/dashboard" className="hover:text-violet-400 transition-colors">Dashboard</Link></li>
              <li><Link href="/demo" className="hover:text-violet-400 transition-colors">AI Demo</Link></li>
            </ul>
          </div>

          {/* Stack */}
          <div>
            <h4 className="text-sm font-semibold text-slate-300 mb-4 uppercase tracking-wider">Stack</h4>
            <ul className="space-y-2 text-sm text-slate-500">
              {["Next.js 16", "FastAPI", "Gemini API", "LangChain + ChromaDB", "Stellar x402"].map((s) => (
                <li key={s} className="flex items-center gap-2">
                  <Zap size={11} className="text-violet-400" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-slate-600">
            © {new Date().getFullYear()} AgenticRAG Paywall. Built with ❤️ and Stellar XLM.
          </p>
          <div className="flex items-center gap-3 text-slate-600">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              <Code2 size={16} />
            </a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              <MessageCircle size={16} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
