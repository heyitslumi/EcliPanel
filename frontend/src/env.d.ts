/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user?: import('./hooks/useAuth').User | null;
    theme?: string | null;
    locale?: string;
  }
}

interface ImportMetaEnv {
  readonly PUBLIC_API_BASE: string;
  readonly PUBLIC_WINGS_BASE: string;
  readonly PUBLIC_COMMIT_SHA: string;
  readonly PUBLIC_REPO_URL: string;
  readonly PUBLIC_HACKCLUB_STUDENT_ENABLED: string;
  readonly BACKEND_URL: string;
  readonly GITHUB_STUDENT_ENABLED: string;
  readonly SITE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}