"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  removeInventorySource,
  saveInventorySource,
  testInventorySource,
  type SourceTest,
} from "@/app/(app)/settings/actions";

type Dialect = "POSTGRES" | "MYSQL" | "MSSQL";
export type InventorySourceInfo = {
  dialect: Dialect;
  query: string;
  customerQuery: string | null;
  historyQuery: string | null;
  orderStatusQuery: string | null;
  columns: string[];
  lastError: string | null;
  lastCheckedAt: string | null;
} | null;

const DIALECTS: { value: Dialect; label: string; example: string }[] = [
  { value: "POSTGRES", label: "PostgreSQL", example: "postgresql://lexues:fjalekalimi@host:5432/db" },
  { value: "MYSQL", label: "MySQL / MariaDB", example: "mysql://lexues:fjalekalimi@host:3306/db" },
  { value: "MSSQL", label: "SQL Server", example: "Server=host,1433;Database=db;User Id=lexues;Password=...;Encrypt=true" },
];

const QUERY_PLACEHOLDER = `SELECT kodi AS sku, emertimi AS name, cmimi AS price, sasia AS stock,
       kategoria AS category, marka AS brand
FROM artikuj
WHERE aktiv = 1`;

type NamedKey = "customerQuery" | "historyQuery" | "orderStatusQuery";

const NAMED_QUERIES: { key: NamedKey; label: string; placeholder: string; help: React.ReactNode }[] = [
  {
    key: "customerQuery",
    label: "Query i klientit (opsional)",
    placeholder: `SELECT id AS client_id, emri AS name, nipt, adresa AS address, borxhi
FROM klientet
WHERE right(regexp_replace(tel, '[^0-9]', '', 'g'), 9) = :phone`,
    help: (
      <>
        Njeh klientin që shkruan në WhatsApp. <code>:phone</code> = 9 shifrat e fundit të numrit (p.sh. <code>691234567</code>),
        prandaj krahasoni me 9 shifrat e fundit të telefonit në DB. Duhet të kthejë <code>client_id, name</code>; opsionale{" "}
        <code>address</code> dhe çdo kolonë tjetër (NIPT, borxhi...). Vetëm kur numri përputhet me saktësisht një klient,
        asistenti i sheh të dhënat e tij.
      </>
    ),
  },
  {
    key: "historyQuery",
    label: "Query i historikut (opsional)",
    placeholder: `SELECT nr AS invoice_no, data AS date, totali AS total, statusi AS status
FROM faturat
WHERE klient_id = :client_id
ORDER BY data DESC
LIMIT 20`,
    help: (
      <>
        Faturat/porositë e fundit të klientit të njohur. <code>:client_id</code> = <code>client_id</code> nga query i klientit.
        Renditni dhe kufizoni brenda query-t (<code>ORDER BY ... LIMIT 20</code>, ose <code>TOP 20</code> në SQL Server);
        merren maksimumi 20 rreshta.
      </>
    ),
  },
  {
    key: "orderStatusQuery",
    label: "Query i statusit të porosisë (opsional)",
    placeholder: `SELECT CASE statusi WHEN 'konfirmuar' THEN 'CONFIRMED' WHEN 'ne pergatitje' THEN 'PREPARING'
       WHEN 'dorezuar' THEN 'DELIVERED' WHEN 'anuluar' THEN 'CANCELLED' ELSE 'PENDING' END AS status
FROM porosi
WHERE referenca = :ref`,
    help: (
      <>
        Stafi e fut porosinë tonë në ERP me referencën <code>AI-&lt;numri&gt;</code>; çdo 5 minuta e lexojmë statusin me{" "}
        <code>:ref</code>. Duhet të kthejë kolonën <code>status</code> me një nga vlerat PENDING, CONFIRMED, PREPARING,
        DELIVERED, CANCELLED (përktheni statuset e tyre me <code>CASE</code>). Opsionale <code>external_status</code> = statusi
        me fjalët e tyre, që i shfaqet stafit.
      </>
    ),
  },
];

export function InventorySourceCard({ initial }: { initial: InventorySourceInfo }) {
  const [dialect, setDialect] = useState<Dialect>(initial?.dialect ?? "POSTGRES");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState(initial?.query ?? "");
  const [named, setNamed] = useState<Record<NamedKey, string>>({
    customerQuery: initial?.customerQuery ?? "",
    historyQuery: initial?.historyQuery ?? "",
    orderStatusQuery: initial?.orderStatusQuery ?? "",
  });
  const [test, setTest] = useState<SourceTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: typeof testInventorySource, done: string) =>
    start(async () => {
      setError(null);
      const res = await fn({ dialect, url, query, ...named });
      if (!res.ok) return setError(res.error);
      setTest(res.data ?? null);
      toast.success(done);
    });

  const remove = () =>
    start(async () => {
      const res = await removeInventorySource();
      if (!res.ok) return setError(res.error);
      setTest(null);
      setUrl("");
      toast.success("Lidhja u hoq. Asistenti përdor sërish katalogun e panelit.");
    });

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Inventari nga DB e dyqanit
          {initial ? <Badge>Aktiv</Badge> : <Badge variant="outline">Jo i lidhur</Badge>}
        </CardTitle>
        <CardDescription>
          Asistenti lexon produktet live nga databaza e dyqanit në çdo kërkim. Kërkojini dyqanit një përdorues vetëm-lexim
          (vetëm SELECT). Porositë nuk e ulin stokun në sistemin e tyre. Vetëm administratori i platformës e sheh këtë.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {initial?.lastError && (
            <p className="text-destructive text-sm">Gabimi i fundit: {initial.lastError}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
            <Field>
              <FieldLabel>Databaza</FieldLabel>
              <Select value={dialect} onValueChange={(v) => setDialect(v as Dialect)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIALECTS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="inv-url">Connection string</FieldLabel>
              <Input
                id="inv-url"
                type="password"
                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={initial ? "I ruajtur (lëreni bosh për ta mbajtur)" : DIALECTS.find((d) => d.value === dialect)!.example}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="inv-query">Query SELECT</FieldLabel>
            <Textarea
              id="inv-query"
              rows={6}
              className="font-mono text-xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={QUERY_PLACEHOLDER}
            />
            <FieldDescription>
              Duhet të kthejë kolonat <code>sku, name, price, stock</code>. Opsionale: <code>category, brand, description, image_url</code>.
              Kolonat e tjera ruhen si specifika. Një SELECT i vetëm, pa <code>;</code>, pa <code>WITH</code> dhe pa <code>ORDER BY</code>.
            </FieldDescription>
          </Field>
          {NAMED_QUERIES.map((n) => (
            <Field key={n.key}>
              <FieldLabel htmlFor={`inv-${n.key}`}>{n.label}</FieldLabel>
              <Textarea
                id={`inv-${n.key}`}
                rows={4}
                className="font-mono text-xs"
                value={named[n.key]}
                onChange={(e) => setNamed((v) => ({ ...v, [n.key]: e.target.value }))}
                placeholder={n.placeholder}
              />
              <FieldDescription>{n.help}</FieldDescription>
            </Field>
          ))}
          {error && <p className="text-destructive text-sm">{error}</p>}
          {test && (
            <div className="flex flex-col gap-2">
              <p className="text-muted-foreground text-sm">
                Kolonat: {test.columns.join(", ")}
                {test.skipped > 0 && ` · ${test.skipped} rreshta pa sku/emër/çmim u anashkaluan`}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Emri</TableHead>
                    <TableHead className="text-right">Çmimi</TableHead>
                    <TableHead className="text-right">Stoku</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {test.sample.map((r) => (
                    <TableRow key={r.sku}>
                      <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                      <TableCell className="max-w-64 truncate">{r.name}</TableCell>
                      <TableCell className="text-right">{r.price}</TableCell>
                      <TableCell className="text-right">{r.stock}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(testInventorySource, "Lidhja funksionon.")}>
          {pending && <Spinner />} Testo
        </Button>
        <Button type="button" disabled={pending} onClick={() => run(saveInventorySource, "Inventari u lidh.")}>
          Ruaj
        </Button>
        {initial && (
          <Button type="button" variant="ghost" className="text-destructive ml-auto" disabled={pending} onClick={remove}>
            Hiq lidhjen
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
