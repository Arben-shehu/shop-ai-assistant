"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { value: "all", label: "Të gjitha" },
  { value: "AI", label: "AI" },
  { value: "HUMAN", label: "Operator" },
  { value: "CLOSED", label: "Mbyllur" },
] as const;

function buildHref(pathname: string, q: string, mode: string) {
  const p = new URLSearchParams();
  if (q.trim()) p.set("q", q.trim());
  if (mode !== "all") p.set("mode", mode);
  const s = p.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/** Search by name/phone and mode tabs; both live in the URL (?q=&mode=). */
export function ListFilters({ q, mode }: { q: string; mode: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.replace(buildHref(pathname, next, mode), { scroll: false }), 300);
  }

  return (
    <div className="flex flex-col gap-3 border-b p-3">
      <InputGroup>
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Kërko emër ose telefon…"
          aria-label="Kërko biseda sipas emrit ose telefonit"
        />
      </InputGroup>
      <Tabs value={mode}>
        <TabsList className="w-full" aria-label="Filtro sipas gjendjes">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} asChild>
              <Link href={buildHref(pathname, value, t.value)} scroll={false} replace>
                {t.label}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
