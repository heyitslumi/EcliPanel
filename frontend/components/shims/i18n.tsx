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

  return useMemo(() => {
    function t(key: string, values?: Record<string, any>): any {
      let val: string = getNested(ns, key) ?? getNested(messages, `${namespace}.${key}`) ?? key;
      if (values) {
        for (const [k, v] of Object.entries(values)) {
          val = val.replace(`{${k}}`, String(v));
        }
      }
      return val;
    }

    t.rich = function rich(key: string, values?: Record<string, any>): React.ReactNode {
      let val: string = getNested(ns, key) ?? getNested(messages, `${namespace}.${key}`) ?? key;
      if (!values) return val;

      let result = val;
      const tagFns: Array<[string, (chunks: React.ReactNode) => React.ReactNode]> = [];

      for (const [k, v] of Object.entries(values)) {
        if (typeof v === "function") {
          tagFns.push([k, v as (chunks: React.ReactNode) => React.ReactNode]);
        } else {
          result = result.replace(`{${k}}`, String(v));
        }
      }

      const parts: React.ReactNode[] = [];
      const tagRegex = /<(\w+)>(.*?)<\/\1>/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = tagRegex.exec(result)) !== null) {
        if (match.index > lastIndex) parts.push(result.slice(lastIndex, match.index));
        const tagName = match[1];
        const fn = tagFns.find(([k]) => k === tagName);
        parts.push(fn ? fn[1](match[2]) : match[2]);
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < result.length) parts.push(result.slice(lastIndex));

      return parts.length > 0 ? <>{parts}</> : result;
    };

    return t;
  }, [ns, messages]);
}

export function useLocale(): string {
  return useI18n().locale;
}