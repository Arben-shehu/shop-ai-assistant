export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const SHOP_ROLE_LABELS: Record<string, string> = {
  owner: "Pronar",
  admin: "Administrator",
  member: "Operator",
};

/** "Dyqani Im Ëç" -> "dyqani-im-ec" */
export function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
