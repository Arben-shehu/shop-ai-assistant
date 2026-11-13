"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError("Email ose fjalëkalim i gabuar.");
    router.push("/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Hyr në llogari</CardTitle>
        <CardDescription>Përdor email-in dhe fjalëkalimin e dyqanit.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Fjalëkalimi</FieldLabel>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </Field>
            {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />} Hyr
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
