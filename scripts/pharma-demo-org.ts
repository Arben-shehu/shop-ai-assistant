// Creates (or updates) the demo org "Depo Farmaceutike Demo" wired to the FAKE pharma ERP from scripts/pharma-test-db.sql.
// Leaves "Demo Computer Shop" alone. Idempotent.
//   PHARMA_TEST_URL=postgresql://pharma_reader:<password>@localhost:5443/pharma_test npx tsx scripts/pharma-demo-org.ts
// The connection string must be the SELECT-only role. Add a WhatsApp channel to the org from the Channels page.
import "../src/lib/ai/node-shim";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { encrypt } from "../src/lib/crypto";
import { saveShopSettings } from "../src/lib/shop-settings";
import { testNamedQuery, testSource } from "../src/lib/inventory/source";
import { missingColumns, missingRequired } from "../src/lib/inventory/sql";

const SLUG = "depo-farmaceutike-demo";

// Same 4 queries as the comments at the top of scripts/pharma-test-db.sql.
const QUERIES = {
  query:
    "SELECT kodi AS sku, emertimi AS name, cmimi AS price, sasia AS stock, kategoria AS category,\n" +
    "       prodhuesi AS brand, principi_aktiv || ' ' || doza || ' ' || forma AS description,\n" +
    "       principi_aktiv, forma, doza, skadenca\nFROM artikujt\nWHERE aktiv",
  customerQuery:
    "SELECT id AS client_id, emri AS name, nipt, adresa || ', ' || qyteti AS address, qyteti,\n" +
    "       borxhi, limiti_kredise\nFROM klientet\nWHERE aktiv AND right(regexp_replace(tel, '[^0-9]', '', 'g'), 9) = :phone",
  historyQuery:
    "SELECT f.nr AS fatura, f.data AS data, f.totali AS totali, f.statusi AS statusi,\n" +
    "       (SELECT string_agg(r.sasia || ' x ' || a.emertimi, ' | ' ORDER BY r.id)\n" +
    "          FROM fatura_rreshtat r JOIN artikujt a ON a.kodi = r.artikull_kodi\n" +
    "         WHERE r.fatura_id = f.id) AS artikujt\nFROM faturat f\nWHERE f.klient_id = :client_id::int\nORDER BY f.data DESC\nLIMIT 20",
  orderStatusQuery:
    "SELECT ref, statusi AS external_status,\n" +
    "       CASE lower(statusi) WHEN 'ne pritje' THEN 'PENDING' WHEN 'konfirmuar' THEN 'CONFIRMED'\n" +
    "            WHEN 'ne pergatitje' THEN 'PREPARING' WHEN 'dorezuar' THEN 'DELIVERED'\n" +
    "            WHEN 'anuluar' THEN 'CANCELLED' END AS status\nFROM porosi_hyrese\nWHERE ref = :ref",
};

const INSTRUCTIONS = `Jemi depo farmaceutike (shitje me shumicë). Klientët janë farmaci.
Çmimet janë me shumicë, në lekë (ALL). Dorëzimi bëhet nga makinat tona sipas itinerarit të qytetit.
Mos jep këshilla mjekësore për pacientët; për pyetje klinike sugjero farmacistin ose mjekun.`;

async function main() {
  const url = process.env.PHARMA_TEST_URL;
  if (!url) throw new Error("Set PHARMA_TEST_URL (the SELECT-only pharma_reader connection string).");

  const test = await testSource("POSTGRES", url, QUERIES.query);
  const missing = missingRequired(test.columns);
  if (missing.length) throw new Error(`Product query misses ${missing.join(", ")}`);
  const c = await testNamedQuery("POSTGRES", url, QUERIES.customerQuery, "phone", "000000000");
  if (missingColumns(c.columns, ["client_id", "name"]).length) throw new Error("customer query columns");
  await testNamedQuery("POSTGRES", url, QUERIES.historyQuery, "client_id", "0");
  const s = await testNamedQuery("POSTGRES", url, QUERIES.orderStatusQuery, "ref", "AI-0");
  if (missingColumns(s.columns, ["status"]).length) throw new Error("status query columns");

  const org =
    (await prisma.organization.findUnique({ where: { slug: SLUG } })) ??
    (await prisma.organization.create({
      data: { id: randomBytes(12).toString("hex"), name: "Depo Farmaceutike Demo", slug: SLUG, createdAt: new Date() },
    }));
  await saveShopSettings(org.id, { currency: "ALL", defaultLanguage: "sq", aiEnabled: true, aiInstructions: INSTRUCTIONS });

  const data = { dialect: "POSTGRES" as const, url: encrypt(url), ...QUERIES, columns: test.columns, isActive: true, lastError: null, lastCheckedAt: new Date() };
  await prisma.inventorySource.upsert({ where: { organizationId: org.id }, create: { organizationId: org.id, ...data }, update: data });

  console.log(`Org "${org.name}" (${org.slug}) wired to the pharma ERP: ${test.columns.length} product columns, sample ${test.sample.length} rows.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
