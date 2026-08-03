"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import DeferredPixelBlast from "@/components/DeferredPixelBlast";
import { SectionDivider } from "../../login/_components/SectionDivider";
import { AlertBanner } from "../../register/_components/AlertBanner";
import {
  Loader2,
  Shield,
  ShieldCheck,
  Lock,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

interface OAuthConsentInfo {
  app: {
    clientId: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    ownerName: string;
  };
  requestedScopes: string[];
  state: string | null;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: string | null;
}

const SCOPE_META: Record<string, string> = {
  profile: "Read your public profile (name and avatar)",
  email: "Read your email address and verification status",
  "servers:read": "View your game servers",
  "servers:write": "Manage your game servers",
  "orgs:read": "View your organisation memberships",
  "billing:read": "View your billing and plan information",
  admin: "Full admin-level access (granted to admins only)",
};

function getLoginHref(): string {
  const back = `/oauth/authorize${window.location.search}`;
  return `/login?redirect=${encodeURIComponent(back)}`;
}

function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-black">
      <div className="flex min-h-screen flex-col md:flex-row">
        <div className="hidden md:block md:flex-1 items-center justify-center overflow-hidden">
          <DeferredPixelBlast
            variant="square"
            color="#B85A96"
            patternScale={1.9}
            patternDensity={1.3}
            pixelSizeJitter={0}
            enableRipples
            rippleSpeed={0.4}
            rippleThickness={0.12}
            rippleIntensityScale={1.5}
            liquid={false}
            liquidStrength={0.12}
            liquidRadius={1.2}
            liquidWobbleSpeed={5}
            speed={0.95}
            edgeFade={0.15}
            transparent
            pixelSize={4}
          />
        </div>

        <div className="flex flex-1 relative z-100 items-center justify-center px-4 py-10 sm:px-8 md:px-10 lg:px-16">
          <div className="w-full max-w-md mx-auto">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  const t = useTranslations("oauthConsentPage");
  const searchParams = useSearchParams();
  const { user, isLoggedIn, isLoading: authLoading } = useAuth();

  const query = searchParams.toString();

  const [info, setInfo] = useState<OAuthConsentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"authorize" | "deny" | null>(null);

  useEffect(() => {
    if (!query) {
      setError(t("errors.missingParams"));
      return;
    }
    let cancelled = false;
    apiFetch(`/api/oauth/authorize?${query}`)
      .then((data: any) => {
        if (cancelled) return;
        if (data?.error) {
          setError(String(data.error));
          return;
        }
        setInfo(data as OAuthConsentInfo);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || t("errors.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [query, t]);

  const submit = useCallback(
    async (approved: boolean) => {
      setBusy(approved ? "authorize" : "deny");
      setError(null);
      try {
        const body: Record<string, unknown> = {
          client_id: searchParams.get("client_id") || "",
          redirect_uri: searchParams.get("redirect_uri") || "",
          approved,
        };
        for (const key of ["scope", "state", "code_challenge", "code_challenge_method"]) {
          const value = searchParams.get(key);
          if (value) body[key] = value;
        }
        const data = await apiFetch("/api/oauth/authorize", { method: "POST", body });
        if (data?.redirect) {
          window.location.assign(data.redirect);
          return;
        }
        if (data?.error) {
          setError(String(data.error));
        } else {
          setError(t("errors.submitFailed"));
        }
      } catch (err: any) {
        const msg = String(err?.message || err || "");
        if (
          err?.status === 401 ||
          /unauthorized|missing auth token|invalid token|not found/i.test(msg)
        ) {
          window.location.assign(getLoginHref());
          return;
        }
        setError(err?.message || t("errors.submitFailed"));
      } finally {
        setBusy(null);
      }
    },
    [searchParams, t]
  );

  if (authLoading) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 rounded-full animate-spin" />
          <p className="mt-3 text-sm">{t("loading")}</p>
        </div>
      </AuthShell>
    );
  }

  if (!isLoggedIn) {
    return (
      <AuthShell>
        <div className="mb-8 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            {t("loginRequired.title")}
          </h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
            {t("loginRequired.description")}
          </p>
        </div>

        <div className="rounded-2xl sm:rounded-3xl">
          <div className="p-4 sm:p-8 space-y-5">
            <a
              href={getLoginHref()}
              className={cn(
                "w-full min-h-[44px] py-3 flex items-center justify-center gap-2 rounded-md font-mono text-base sm:text-lg border border-white/40 transition-colors duration-200 cursor-pointer",
                "text-black bg-white",
                "hover:bg-white/70 active:scale-[0.98]",
              )}
            >
              {t("loginRequired.signIn")}
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (error) {
    return (
      <AuthShell>
        <div className="rounded-2xl sm:rounded-3xl">
          <div className="p-4 sm:p-8 space-y-5">
            <AlertBanner variant="error" title={t("errors.title")}>
              {error}
            </AlertBanner>
          </div>
        </div>
      </AuthShell>
    );
  }

  if (!info) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-6 w-6 rounded-full animate-spin" />
          <p className="mt-3 text-sm">{t("loading")}</p>
        </div>
      </AuthShell>
    );
  }

  const app = info.app;
  const displayName =
    user?.displayName ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
    user?.email;

  return (
    <AuthShell>
      <div className="mb-8 text-center">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
          {t("title")}
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="rounded-2xl sm:rounded-3xl">
        <div className="p-4 sm:p-8 space-y-5">
          <SectionDivider label={t("application")} icon={Shield} />

          <div className="rounded-md border border-white/20 p-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-secondary/30">
                {app.logoUrl ? (
                  <img src={app.logoUrl} alt={app.name} className="h-full w-full object-cover" />
                ) : (
                  <ShieldCheck className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-foreground">{app.name}</p>
                {app.description ? (
                  <p className="truncate text-sm text-muted-foreground">{app.description}</p>
                ) : null}
                <p className="text-xs text-muted-foreground/70">
                  {t("byOwner")} {app.ownerName}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-white/20 bg-secondary/10 p-4">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
              {t("signedInAs")}
            </p>
            <p className="mt-1 font-mono text-sm text-foreground">{displayName}</p>
            {user?.email ? <p className="text-xs text-muted-foreground">{user.email}</p> : null}
          </div>

          <SectionDivider label={t("permissions")} icon={Lock} />

          <ul className="space-y-2.5">
            {info.requestedScopes.map(scope => {
              const meta = SCOPE_META[scope];
              return (
                <li key={scope} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {meta ? scope.replace(/:.*/, "") : scope}
                    </p>
                    {meta ? <p className="text-sm text-muted-foreground">{meta}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={busy !== null}
              className={cn(
                "w-full min-h-[44px] py-3 flex gap-2 items-center justify-center rounded-md font-mono text-base sm:text-lg border border-white/40 transition-colors duration-200 cursor-pointer",
                "text-white",
                "hover:bg-white/70 hover:text-black active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {busy === "deny" ? (
                <Loader2 className="h-4 w-4 rounded-full animate-spin" />
              ) : null}
              {t("actions.cancel")}
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={busy !== null}
              className={cn(
                "w-full min-h-[44px] py-3 flex items-center justify-center gap-2 rounded-md font-mono text-base sm:text-lg border border-white/40 transition-colors duration-200 cursor-pointer",
                "text-black bg-white",
                "hover:bg-white/70 active:scale-[0.98]",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {busy === "authorize" ? (
                <Loader2 className="h-4 w-4 rounded-full animate-spin" />
              ) : null}
              {t("actions.authorize")}
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground/60">
        {t("securityNote")}
      </p>
    </AuthShell>
  );
}