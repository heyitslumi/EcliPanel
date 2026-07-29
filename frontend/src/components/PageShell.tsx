"use client";

import React, { Suspense } from "react";
import { IntlProvider } from "@/components/shims/i18n";
import { AuthProvider, type User } from "@/hooks/useAuth";
import { Footer } from "@/components/Footer";
import { RenderLogger } from "@/components/RenderLogger";
import GlobalQueryBanner from "@/components/GlobalQueryBanner";
import Guide from "@/components/Guide";
import { GlobalLinkGuard } from "@/components/panel/global-link-guard";
import { GlobalImageProxy } from "@/components/panel/global-image-proxy";
import TelemetryProvider from "@/components/TelemetryProvider";
import { CookieConsent } from "@/components/panel/cookie-consent";
import AppRouter from "@/src/components/AppRouter";
import LandingClient from "@/app/LandingClient";

interface PageShellProps {
  locale: string;
  messages: Record<string, any>;
  initialUser?: User | null;
  page?: "landing" | "app";
  pathname?: string;
}

function PageContent({ page, pathname }: { page?: "landing" | "app"; pathname?: string }) {
  if (page === "landing") {
    return <LandingClient />;
  }
  return <AppRouter serverPathname={pathname} />;
}

export default function PageShell({
  locale,
  messages,
  initialUser,
  page,
  pathname,
}: PageShellProps) {
  return (
    <IntlProvider locale={locale} messages={messages}>
      <AuthProvider initialUser={initialUser ?? null}>
        <div suppressHydrationWarning>
        <Suspense fallback={null}>
          <Guide />
        </Suspense>
        <Suspense fallback={null}>
          <GlobalQueryBanner />
        </Suspense>
        <RenderLogger />
        <Suspense fallback={null}>
          <GlobalLinkGuard />
        </Suspense>
        <Suspense fallback={null}>
          <GlobalImageProxy />
        </Suspense>
        <Suspense fallback={null}>
          <TelemetryProvider />
        </Suspense>
        <div className="flex-1 flex flex-col min-w-0">
          <PageContent page={page} pathname={pathname} />
        </div>
        <Footer hideOnDashboard />
        <CookieConsent />
        </div>
      </AuthProvider>
    </IntlProvider>
  );
}
