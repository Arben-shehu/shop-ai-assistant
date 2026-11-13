// Readable Albanian for audit-log actions ("<entity>.<verb>"). Unknown entries degrade to a cleaned-up raw form.

const ENTITY: Record<string, string> = {
  order: "Porosi",
  product: "Produkt",
  stock: "Magazinë",
  conversation: "Bisedë",
  message: "Mesazh",
  customer: "Klient",
  channel: "Kanal",
  member: "Anëtar",
  operator: "Operator",
  invitation: "Ftesë",
  user: "Përdorues",
  ticket: "Tiketë",
  help: "Ndihmë",
  settings: "Cilësime",
  shop: "Dyqan",
  organization: "Dyqan",
  notification: "Njoftim",
  auth: "Hyrje",
  ai: "AI",
};

const VERB: Record<string, string> = {
  created: "Krijoi",
  create: "Krijoi",
  updated: "Përditësoi",
  update: "Përditësoi",
  deleted: "Fshiu",
  delete: "Fshiu",
  removed: "Hoqi",
  added: "Shtoi",
  status_changed: "Ndryshoi statusin",
  mode_changed: "Ndryshoi mënyrën",
  role_changed: "Ndryshoi rolin",
  stock_changed: "Ndryshoi stokun",
  stock_adjusted: "Korrigjoi stokun",
  price_changed: "Ndryshoi çmimin",
  assigned: "Caktoi",
  unassigned: "Hoqi caktimin",
  takeover: "Mori bisedën",
  taken_over: "Mori bisedën",
  handed_back: "Ia ktheu AI-së",
  handover: "Kaloi te operatori",
  released: "Ia ktheu AI-së",
  closed: "Mbylli",
  reopened: "Rihapi",
  replied: "U përgjigj",
  sent: "Dërgoi",
  connected: "Lidhi",
  disconnected: "Shkëputi",
  invited: "Ftoi",
  accepted: "Pranoi",
  revoked: "Anuloi",
  cancelled: "Anuloi",
  imported: "Importoi",
  exported: "Eksportoi",
  enabled: "Aktivizoi",
  disabled: "Çaktivizoi",
  login: "Hyri",
  logout: "Doli",
  banned: "Bllokoi",
  unbanned: "Zhbllokoi",
  impersonated: "Hyri si përdorues",
  notes_updated: "Përditësoi shënimet",
  archived: "Arkivoi",
  activated: "Aktivizoi",
  deactivated: "Çaktivizoi",
  reconnected: "Rilidhi",
  token_updated: "Përditësoi tokenin",
  handoff: "AI ia kaloi operatorit",
  returned_to_ai: "Ia ktheu AI-së",
  entered_by_admin: "Administratori hyri në dyqan",
  password_reset: "Rivendosi fjalëkalimin",
  admin_replied: "Mbështetja u përgjigj",
};

/** entityType values are not uniform across modules ("Channel", "help_ticket"...): normalize to the action prefixes. */
export function normalizeEntity(type: string | null | undefined) {
  const t = (type ?? "").toLowerCase();
  if (t === "help_ticket" || t === "helpticket") return "ticket";
  return t || null;
}

export const entityLabel = (prefix: string) => ENTITY[prefix] ?? humanize(prefix);

export function actionLabel(action: string) {
  const [, ...rest] = action.split(".");
  const verb = rest.join(".");
  return VERB[verb] ?? (humanize(verb || action) || action);
}

function humanize(s: string) {
  const t = s.replace(/[._-]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const STATUS: Record<string, string> = {
  PENDING: "Në pritje",
  CONFIRMED: "Konfirmuar",
  PREPARING: "Në përgatitje",
  DELIVERED: "Dorëzuar",
  CANCELLED: "Anuluar",
  AI: "AI",
  HUMAN: "Operator",
  CLOSED: "Mbyllur",
  OPEN: "Hapur",
  IN_PROGRESS: "Në proces",
  RESOLVED: "Zgjidhur",
};
const val = (v: unknown) => (typeof v === "string" ? (STATUS[v] ?? v) : String(v));

// Only meta fields worth showing to a shop admin, with Albanian names; everything else stays out of the UI.
const META_KEYS: Record<string, string> = {
  name: "Emri",
  email: "Email",
  role: "Roli",
  subject: "Subjekti",
  status: "Statusi",
  priority: "Prioriteti",
  reason: "Arsyeja",
  delta: "Ndryshimi",
  stock: "Stoku",
  quantity: "Sasia",
  sku: "SKU",
};

/** Short one-line summary of the meta JSON: "A → B" for changes, otherwise up to 3 known fields. */
export function metaSummary(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const m = meta as Record<string, unknown>;
  if ("from" in m && "to" in m) return `${val(m.from)} → ${val(m.to)}`;
  const parts = Object.entries(m)
    .filter(([k, v]) => k in META_KEYS && ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 3)
    .map(([k, v]) => `${META_KEYS[k]}: ${val(v)}`);
  const s = parts.join(" · ");
  return s ? (s.length > 120 ? `${s.slice(0, 117)}…` : s) : null;
}
