import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination";

type Params = Record<string, string | string[] | undefined>;

function hrefFor(pathname: string, params: Params, page: number) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k === "page" || k === "order" || typeof v !== "string" || !v) continue;
    sp.set(k, v);
  }
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function pageWindow(page: number, total: number): (number | "…")[] {
  const pages = new Set([1, total, page - 1, page, page + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

/** Server-rendered pagination with Next links. "Shfaqen 21–40 nga 89". */
export function ListPagination({
  pathname,
  params,
  page,
  pageSize,
  total,
}: {
  pathname: string;
  params: Params;
  page: number;
  pageSize: number;
  total: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
      <p className="text-muted-foreground text-sm">
        Shfaqen {from}–{to} nga {total}
      </p>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto" aria-label="Faqet">
          <PaginationContent>
            <PaginationItem>
              {page > 1 ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={hrefFor(pathname, params, page - 1)} scroll={false} aria-label="Faqja e mëparshme">
                    <ChevronLeftIcon data-icon="inline-start" />
                    <span className="hidden sm:block">Para</span>
                  </Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled aria-label="Faqja e mëparshme">
                  <ChevronLeftIcon data-icon="inline-start" />
                  <span className="hidden sm:block">Para</span>
                </Button>
              )}
            </PaginationItem>
            {pageWindow(page, totalPages).map((p, i) =>
              p === "…" ? (
                <PaginationItem key={`e${i}`} className="hidden sm:block">
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p} className={p === page ? undefined : "hidden sm:block"}>
                  <Button asChild variant={p === page ? "outline" : "ghost"} size="icon-sm">
                    <Link
                      href={hrefFor(pathname, params, p)}
                      scroll={false}
                      aria-label={`Faqja ${p}`}
                      aria-current={p === page ? "page" : undefined}
                    >
                      {p}
                    </Link>
                  </Button>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              {page < totalPages ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={hrefFor(pathname, params, page + 1)} scroll={false} aria-label="Faqja tjetër">
                    <span className="hidden sm:block">Tjetra</span>
                    <ChevronRightIcon data-icon="inline-end" />
                  </Link>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" disabled aria-label="Faqja tjetër">
                  <span className="hidden sm:block">Tjetra</span>
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              )}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
