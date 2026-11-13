import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const key = () => Buffer.from(process.env.ENCRYPTION_KEY!, "hex"); // 32 bytes

/** AES-256-GCM. Output: iv.tag.ciphertext (base64url). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export const encryptJson = (v: unknown) => encrypt(JSON.stringify(v));
export const decryptJson = <T>(s: string): T => JSON.parse(decrypt(s)) as T;
