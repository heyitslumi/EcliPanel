"use client";
// This thingy replaces next/dynamic w react lazy + suspense
// Usage is as following const Comp = dynamic(() => import('./Comp'), { ssr: false, loading: () => <Skeleton /> })

import React, { Suspense } from "react";
import type { ComponentType } from "react";

type DynamicOptions = {
  ssr?: boolean;
  loading?: () => React.ReactNode;
};

export default function dynamic<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  options?: DynamicOptions,
): React.ComponentType<any> {
  const Lazy = React.lazy(loader);
  const fallback = options?.loading?.() ?? null;

  function DynamicComponent(props: any) {
    return (
      <Suspense fallback={fallback}>
        <Lazy {...props} />
      </Suspense>
    );
  }

  return DynamicComponent;
}