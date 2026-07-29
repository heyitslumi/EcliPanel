"use client";

import React, { createContext, useContext, useMemo } from "react";

type Messages = Record<string, any>;

interface I18nContextValue {
  locale: string;
  messages: Messages;
}

function getNested(obj: Record<string, any>, path: string): string | undefined {
  const keys = path.split(".");
  let current: any = obj;
  for (const k of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[k];
  }
  return typeof current === "string" ? current : undefined;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function IntlProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    return { locale: "en", messages: {} };
  }
  return ctx;
}

export function useTranslations(namespace: string) {
  const { messages } = useI18n();
  const ns = messages[namespace] ?? {};

  return function t(key: string, values?: Record<string, string | number>): string {
    let val: string = getNested(ns, key) ?? getNested(messages, `${namespace}.${key}`) ?? key;

    if (values) {
      for (const [k, v] of Object.entries(values)) {
        val = val.replace(`{${k}}`, String(v));
      }
    }

    return val;
  };
}

export function useLocale(): string {
  return useI18n().locale;
}