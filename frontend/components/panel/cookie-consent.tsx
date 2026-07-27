"use client"

import { useEffect, useState } from "react";
import Link from "next/link";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("cookie_consent") === "1") return;
    const id = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(id);
  }, []);

  if (!visible || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] px-3 pb-3 sm:px-4 sm:pb-4 pointer-events-none">
      <div className="mx-auto max-w-2xl pointer-events-auto border border-white/10 bg-black/90 backdrop-blur-xl shadow-2xl shadow-black/50 p-4 sm:p-5 animate-in slide-in-from-bottom-6 fade-in duration-500">
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white tracking-tight">We use cookies</h3>
            <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed">
              EclipseSystems under Misiu LLC uses cookies and similar technologies essential for authentication, security, and sessions. We process personal data (such as IP addresses) in the United States, the European Union, and other jurisdictions. By using our service, you consent under applicable US privacy laws (including CCPA) and, where applicable, Article 49(1)(a) GDPR.
            </p>
            <p className="text-xs text-neutral-500">
              <Link href="/legal/cookies-policy" className="underline underline-offset-2 hover:text-neutral-300 transition-colors">Cookie Policy</Link>
              {" · "}
              <Link href="/legal/privacy-policy" className="underline underline-offset-2 hover:text-neutral-300 transition-colors">Privacy Policy</Link>
            </p>
          </div>
          <button
            onClick={() => { localStorage.setItem("cookie_consent", "1"); setDismissed(true); }}
            className="w-full sm:w-auto sm:self-start h-10 px-8 bg-white text-black text-sm font-medium hover:bg-neutral-200 active:scale-[0.98] transition-all"
          >
            Accept all cookies
          </button>
        </div>
      </div>
    </div>
  );
}
