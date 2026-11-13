"use client";
import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Update list filters in the URL (the server page re-renders from searchParams).
 * Changing any filter resets `page` and closes the detail (`order`) unless they are set explicitly.
 */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParams(patch: Record<string, string | null | undefined>, opts: { keepPage?: boolean } = {}) {
    const sp = new URLSearchParams(searchParams.toString());
    if (!opts.keepPage) sp.delete("page");
    sp.delete("order");
    for (const [k, v] of Object.entries(patch)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return { searchParams, setParams, isPending };
}
