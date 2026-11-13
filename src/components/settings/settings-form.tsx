"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateSettings } from "@/app/(app)/settings/actions";

type Currency = "EUR" | "ALL" | "USD";
type Language = "sq" | "en" | "it";

export type SettingsFormValues = {
  name: string;
  aiEnabled: boolean;
  aiInstructions: string;
  currency: string;
  defaultLanguage: Language;
};

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "EUR", label: "Euro (EUR)" },
  { value: "ALL", label: "Lek (ALL)" },
  { value: "USD", label: "Dollar (USD)" },
];

const LANGUAGES: { value: Language; label: string }[] = [
  { value: "sq", label: "Shqip" },
  { value: "en", label: "Anglisht" },
  { value: "it", label: "Italisht" },
];

const INSTRUCTIONS_PLACEHOLDER = `Shembull:
- Toni: miqësor dhe i shkurtër, përdor "ju".
- Dërgesa: Tiranë 200 lekë (brenda ditës), qytete të tjera 400 lekë (1–2 ditë). Falas mbi 10 000 lekë.
- Orari: E hënë–E shtunë 09:00–20:00, e diela mbyllur.
- Pagesa: cash në dorëzim ose transfertë bankare.
- Garancia: 12 muaj për elektronikën.
- Nëse klienti kërkon ulje çmimi ose ka ankesë, kaloja bisedën një operatori.`;

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const [name, setName] = useState(initial.name);
  const [aiEnabled, setAiEnabled] = useState(initial.aiEnabled);
  const [aiInstructions, setAiInstructions] = useState(initial.aiInstructions);
  const [currency, setCurrency] = useState<Currency>(
    CURRENCIES.some((c) => c.value === initial.currency) ? (initial.currency as Currency) : "EUR",
  );
  const [defaultLanguage, setDefaultLanguage] = useState<Language>(initial.defaultLanguage);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await updateSettings({ name, aiEnabled, aiInstructions, currency, defaultLanguage });
      if (!res.ok) return setError(res.error);
      toast.success("Cilësimet u ruajtën.");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Dyqani</CardTitle>
          <CardDescription>Emri shfaqet në panel dhe mund të përdoret nga asistenti.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="s-name">Emri i dyqanit</FieldLabel>
              <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="s-currency">Monedha</FieldLabel>
                <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                  <SelectTrigger id="s-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="s-language">Gjuha e parazgjedhur e përgjigjeve</FieldLabel>
                <Select value={defaultLanguage} onValueChange={(v) => setDefaultLanguage(v as Language)}>
                  <SelectTrigger id="s-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Përdoret kur gjuha e klientit nuk është e qartë.</FieldDescription>
              </Field>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Asistenti AI</CardTitle>
          <CardDescription>Si u përgjigjet asistenti klientëve në WhatsApp dhe Instagram.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="s-ai">Asistenti AI aktiv</FieldLabel>
                <FieldDescription>
                  Kur është i çaktivizuar, mesazhet e reja presin përgjigje nga operatorët.
                </FieldDescription>
              </FieldContent>
              <Switch id="s-ai" checked={aiEnabled} onCheckedChange={setAiEnabled} />
            </Field>
            <Field>
              <FieldLabel htmlFor="s-instructions">Udhëzime për asistentin</FieldLabel>
              <Textarea
                id="s-instructions"
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                rows={10}
                maxLength={4000}
                placeholder={INSTRUCTIONS_PLACEHOLDER}
                className="min-h-56"
              />
              <FieldDescription>
                Toni, zonat dhe kostot e dërgesës, orari, mënyrat e pagesës, rregullat e kthimit. {aiInstructions.length}/4000
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />} Ruaj ndryshimet
        </Button>
      </div>
    </form>
  );
}
