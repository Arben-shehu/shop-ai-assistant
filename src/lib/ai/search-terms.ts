/**
 * Turns a free-text customer query (Albanian / English / Italian mix) into term groups for product search.
 * Each group = one meaningful word plus its variants (accent-free spelling, singular, synonyms in the other language).
 * A product matches a group if ANY variant appears in name/sku/brand/category/description.
 * Ported in spirit from the old language-translator.ts, as a small static list — no LLM-written SQL.
 */

const MAX_GROUPS = 6;
const MAX_VARIANTS = 8;

/** Keys are accent-folded (ë→e, ç→c). Values are extra variants to search for. */
const SYNONYMS: Record<string, string[]> = {
  // categories
  laptop: ["laptop", "notebook"],
  laptope: ["laptop", "notebook"],
  laptopa: ["laptop", "notebook"],
  notebook: ["laptop"],
  kompjuter: ["computer", "pc", "desktop"],
  kompjuteri: ["computer", "pc", "desktop"],
  kompjutera: ["computer", "pc", "desktop"],
  computer: ["kompjuter", "pc", "desktop"],
  desktop: ["pc", "computer", "kompjuter"],
  monitor: ["display", "ekran"],
  monitori: ["monitor", "display"],
  ekran: ["monitor", "display", "screen"],
  ekrani: ["monitor", "display", "screen"],
  telefon: ["phone", "smartphone"],
  telefoni: ["phone", "smartphone"],
  celular: ["phone", "smartphone"],
  tablet: ["tablet", "ipad"],
  printer: ["printer", "printues"],
  printues: ["printer"],
  // parts / specs
  procesor: ["processor", "cpu"],
  procesori: ["processor", "cpu"],
  memorje: ["ram", "memory"],
  memoria: ["ram", "memory"],
  memorja: ["ram", "memory"],
  disk: ["ssd", "hdd", "storage"],
  disku: ["ssd", "hdd", "storage"],
  grafika: ["gpu", "graphics", "rtx", "radeon"],
  grafike: ["gpu", "graphics", "rtx", "radeon"],
  karte: ["card"],
  bateri: ["battery"],
  bateria: ["battery"],
  karikues: ["charger", "adapter"],
  karikuesi: ["charger", "adapter"],
  kabell: ["cable"],
  kabli: ["cable"],
  cante: ["bag", "backpack"],
  canta: ["bag", "backpack"],
  // peripherals
  tastiere: ["keyboard"],
  tastiera: ["keyboard"],
  keyboard: ["tastiere"],
  maus: ["mouse"],
  mousi: ["mouse"],
  mouse: ["maus"],
  kufje: ["headset", "headphones", "earphones"],
  kufjet: ["headset", "headphones", "earphones"],
  headphones: ["kufje", "headset"],
  altoparlant: ["speaker"],
  kamera: ["camera", "webcam"],
  // use / condition
  lojera: ["gaming", "game"],
  lojra: ["gaming", "game"],
  gaming: ["game"],
  biznes: ["business"],
  pune: ["business", "office"],
  zyre: ["office"],
  perdorur: ["used", "refurbished"],
  garanci: ["warranty"],
  // brands (family names customers use)
  lenovo: ["thinkpad", "ideapad", "legion"],
  apple: ["macbook", "imac", "iphone"],
  macbook: ["apple"],
};

/** Filler words that would make every search fail (they never appear in product data). */
const STOPWORDS = new Set(
  (
    "a ai ajo e i te të me më ne në nje një dhe ose per për nga deri mbi nen nën sa si ku cili cila cilat cfare çfarë " +
    "keni ka kam kemi dua doja do doj desha kerkoj kërkoj mund kushton cmim cmimi çmim çmimi sasi cope copë cop stok " +
    "pershendetje përshëndetje mirdita mirëdita faleminderit ju lutem po jo shume shumë mire mirë model modele " +
    "the an and or of for to with in on at is are do you have any want need please price how much show me some " +
    "il la lo di da per con avete vorrei un una prezzo quanto"
  ).split(/\s+/),
);

export function foldAccents(s: string): string {
  return s.replace(/[ëé]/g, "e").replace(/ç/g, "c");
}

/** Strip common Albanian plural/definite endings: laptopët → laptop, monitori → monitor. */
function singular(word: string): string | null {
  if (!/^[a-z]+$/.test(word) || word.length < 6) return null;
  for (const suf of ["et", "at", "it", "t", "a", "e", "i"]) {
    if (word.endsWith(suf) && word.length - suf.length >= 4) return word.slice(0, -suf.length);
  }
  return null;
}

/** Number + unit, written with or without a space. Doses (mg, ml, mcg, iu) matter for pharmacies. */
const UNIT = /(\d+(?:[.,]\d+)?)\s*(gb|tb|mb|hz|mah|w|mm|cm|mg|mcg|ml|kg|g|l|iu)\b/g;
const UNIT_TOKEN = /^(\d+(?:[.,]\d+)?)(gb|tb|mb|hz|mah|w|mm|cm|mg|mcg|ml|kg|g|l|iu)$/;

export function searchTermGroups(query: string): string[][] {
  const normalised = query
    .toLowerCase()
    .replace(UNIT, "$1$2") // "16 gb" → "16gb", "500 mg" → "500mg"
    .replace(/[^\p{L}\p{N}.\-+]+/gu, " ")
    .trim();

  const groups: string[][] = [];
  const seen = new Set<string>();
  for (const raw of normalised.split(" ")) {
    const word = raw.replace(/^[.\-+]+|[.\-+]+$/g, "");
    if (!word || STOPWORDS.has(word) || STOPWORDS.has(foldAccents(word))) continue;
    if (word.length < 2 && !/\d/.test(word)) continue;
    const folded = foldAccents(word);
    if (seen.has(folded)) continue;
    seen.add(folded);

    const variants = new Set<string>([word, folded]);
    const unit = UNIT_TOKEN.exec(word);
    if (unit) variants.add(`${unit[1]} ${unit[2]}`); // the catalogue may write "500 mg"
    const single = singular(folded);
    if (single) variants.add(single);
    for (const key of [folded, single]) if (key && SYNONYMS[key]) for (const s of SYNONYMS[key]) variants.add(s);
    groups.push([...variants].slice(0, MAX_VARIANTS));
    if (groups.length >= MAX_GROUPS) break;
  }
  return groups;
}

/** Variants for a single filter value (category / brand), e.g. "laptopë" → ["laptopë", "laptope", "laptop", "notebook"]. */
export function termVariants(value: string): string[] {
  const t = value.trim().toLowerCase();
  if (!t) return [];
  const folded = foldAccents(t);
  const v = new Set<string>([t, folded]);
  const single = singular(folded);
  if (single) v.add(single);
  for (const key of [folded, single]) if (key && SYNONYMS[key]) for (const s of SYNONYMS[key]) v.add(s);
  return [...v].slice(0, MAX_VARIANTS);
}
