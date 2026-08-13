"use client"

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";
import { API_ENDPOINTS } from "@/lib/panel-config";
const CONSENT_VERSION = "1";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("cookie_consent") !== null) return;
    const id = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(id);
  }, []);

  if (!visible || dismissed) return null;

  const choose = (consent: "essential" | "all") => {
    localStorage.setItem("cookie_consent", consent);
    apiFetch(API_ENDPOINTS.userConsent, {
      method: "POST",
      body: { consent, version: CONSENT_VERSION },
    }).catch(() => {});
    setDismissed(true);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] px-3 pb-3 sm:px-4 sm:pb-4 pointer-events-none">
      <div className="mx-auto max-w-2xl pointer-events-auto border border-white/10 bg-black/90 backdrop-blur-xl shadow-2xl shadow-black/50 p-4 sm:p-5 animate-in slide-in-from-bottom-6 fade-in duration-500">
        <div className="flex flex-col gap-3 sm:gap-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white tracking-tight">Cookies and privacy</h3>
            <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed">
              We use strictly necessary cookies for authentication, security, and sessions. With your
              consent we also run first-party analytics and process personal data (such as IP addresses)
              in the United States, the European Union, and other jurisdictions. Choosing "Accept all"
              enables analytics; "Essential only" keeps strictly necessary cookies only. When you are
              signed in, your choice is recorded in your account.
            </p>
            <p className="text-xs text-neutral-500">
              <Link href="/legal/cookies-policy" className="underline underline-offset-2 hover:text-neutral-300 transition-colors">Cookie Policy</Link>
              {" · "}
              <Link href="/legal/privacy-policy" className="underline underline-offset-2 hover:text-neutral-300 transition-colors">Privacy Policy</Link>
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
            <button
              onClick={() => choose("essential")}
              className="h-10 px-6 border border-white/20 text-white text-sm font-medium hover:bg-white/5 active:scale-[0.98] transition-all"
            >
              Essential only
            </button>
            <button
              onClick={() => choose("all")}
              className="h-10 px-8 bg-white text-black text-sm font-medium hover:bg-neutral-200 active:scale-[0.98] transition-all"
            >
              Accept all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
