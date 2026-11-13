// Phone helpers for WhatsApp addresses. Ported from SunEasy:
//  - normalizePhone: Auth NormalizePhoneNumber fix (0xxx -> 355xxx, +355 -> 355, 00 -> drop; digits only)
//  - isPlausiblePhone: Notification/Services/WhatsAppPhoneValidator.cs
// Only apply these to bare-digit WhatsApp numbers, never to "...@lid" ids or Instagram IGSIDs.

/** The customer address can never be delivered to (not a channel problem): fail the message without retrying. */
export class InvalidRecipientError extends Error {}

const DEFAULT_COUNTRY_CODE = "355"; // Albania

/** Canonical E.164 digits (no "+"). "0691234567" -> "355691234567", "+355 69..." -> "35569...", "0039..." -> "39...". */
export function normalizePhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = DEFAULT_COUNTRY_CODE + d.slice(1);
  return d;
}

const PLACEHOLDERS = /^(?:0{8,}|1234567890|0123456789|0987654321|1{8,}|9{8,})$/;

/** Rejects obviously fake numbers (seed/test data) that only waste rate-limit slots and fail at the gateway. */
export function isPlausiblePhone(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  const d = raw.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return false;
  if (PLACEHOLDERS.test(d)) return false;
  return new Set(d).size > 1;
}

/** WhatsApp chat id for a customer address: jids ("...@lid", "...@c.us") pass through, digits get "@c.us". */
export function toWhatsAppChatId(address: string): string | null {
  if (address.includes("@")) return address;
  const d = normalizePhone(address);
  return isPlausiblePhone(d) ? `${d}@c.us` : null;
}

/** Splits text longer than `max` into numbered parts at paragraph (then line, then word) boundaries. */
export function splitMessage(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const budget = max - 8; // room for the "(12/12) " prefix
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    let cut = window.lastIndexOf("\n\n");
    if (cut < budget * 0.3) cut = window.lastIndexOf("\n");
    if (cut < budget * 0.3) cut = window.lastIndexOf(" ");
    if (cut < budget * 0.3) cut = budget;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.map((p, i) => `(${i + 1}/${parts.length}) ${p}`);
}
