-- FAKE Albanian pharmaceutical-warehouse ERP for testing the shop AI assistant (B2B: pharmacies order on WhatsApp).
-- Every pharmacy, manufacturer, NIPT and phone number here is invented. Active ingredients are generic (INN) names.
--
-- Apply (Postgres 13+), from the repo root:
--   createdb -h localhost -p 5443 -U shop pharma_test          (or: CREATE DATABASE pharma_test;)
--   psql -h localhost -p 5443 -U shop -d pharma_test -v ON_ERROR_STOP=1 \
--        -v reader_password='choose-one' -f scripts/pharma-test-db.sql
-- Re-running drops and re-creates the tables. It creates a SELECT-only login role `pharma_reader` (password from
-- -v reader_password, default 'pharma_reader_dev' — local test only) for the app's connection string:
--   postgresql://pharma_reader:<password>@localhost:5443/pharma_test
--
-- ===== The 4 admin queries to paste in Cilësimet > Inventari nga DB e dyqanit (dialect PostgreSQL) =====
--
-- 1) Produktet (Query SELECT):
--   SELECT kodi AS sku, emertimi AS name, cmimi AS price, sasia AS stock, kategoria AS category,
--          prodhuesi AS brand, principi_aktiv || ' ' || doza || ' ' || forma AS description,
--          principi_aktiv, forma, doza, skadenca
--   FROM artikujt
--   WHERE aktiv
--
-- 2) Klienti (:phone = 9 shifrat e fundit të numrit WhatsApp):
--   SELECT id AS client_id, emri AS name, nipt, adresa || ', ' || qyteti AS address, qyteti,
--          borxhi, limiti_kredise
--   FROM klientet
--   WHERE aktiv AND right(regexp_replace(tel, '[^0-9]', '', 'g'), 9) = :phone
--
-- 3) Historiku (:client_id nga query i klientit; renditja dhe LIMIT brenda query-t; pa ';' as brenda tekstit):
--   SELECT f.nr AS fatura, f.data AS data, f.totali AS totali, f.statusi AS statusi,
--          (SELECT string_agg(r.sasia || ' x ' || a.emertimi, ' | ' ORDER BY r.id)
--             FROM fatura_rreshtat r JOIN artikujt a ON a.kodi = r.artikull_kodi
--            WHERE r.fatura_id = f.id) AS artikujt
--   FROM faturat f
--   WHERE f.klient_id = :client_id::int
--   ORDER BY f.data DESC
--   LIMIT 20
--
-- 4) Statusi i porosisë (:ref = "AI-<numri>", stafi e shkruan te porosi_hyrese.ref):
--   SELECT ref, statusi AS external_status,
--          CASE lower(statusi) WHEN 'ne pritje' THEN 'PENDING' WHEN 'konfirmuar' THEN 'CONFIRMED'
--               WHEN 'ne pergatitje' THEN 'PREPARING' WHEN 'dorezuar' THEN 'DELIVERED'
--               WHEN 'anuluar' THEN 'CANCELLED' END AS status
--   FROM porosi_hyrese
--   WHERE ref = :ref
-- =====================================================================================================================

\if :{?reader_password}
\else
  \set reader_password 'pharma_reader_dev'
\endif

BEGIN;

DROP TABLE IF EXISTS porosi_hyrese, fatura_rreshtat, faturat, artikujt, klientet CASCADE;

CREATE TABLE klientet (
  id              serial PRIMARY KEY,
  emri            text NOT NULL,
  nipt            text NOT NULL UNIQUE,
  adresa          text,
  qyteti          text,
  tel             text,
  email           text,
  borxhi          numeric(12,2) NOT NULL DEFAULT 0,   -- debt, ALL
  limiti_kredise  numeric(12,2) NOT NULL DEFAULT 0,   -- credit limit, ALL
  aktiv           boolean NOT NULL DEFAULT true
);

CREATE TABLE artikujt (
  kodi            text PRIMARY KEY,
  emertimi        text NOT NULL,
  principi_aktiv  text NOT NULL,
  forma           text NOT NULL,
  doza            text NOT NULL,
  prodhuesi       text NOT NULL,
  cmimi           numeric(10,2) NOT NULL,             -- wholesale price, ALL
  sasia           integer NOT NULL,
  kategoria       text NOT NULL,
  skadenca        date NOT NULL,
  aktiv           boolean NOT NULL DEFAULT true
);

CREATE TABLE faturat (
  id         serial PRIMARY KEY,
  nr         text NOT NULL UNIQUE,
  klient_id  integer NOT NULL REFERENCES klientet(id),
  data       date NOT NULL,
  totali     numeric(12,2) NOT NULL DEFAULT 0,
  statusi    text NOT NULL                           -- 'paguar' | 'pjeserisht' | 'e papaguar'
);
CREATE INDEX faturat_klient_data ON faturat (klient_id, data DESC);

CREATE TABLE fatura_rreshtat (
  id            serial PRIMARY KEY,
  fatura_id     integer NOT NULL REFERENCES faturat(id) ON DELETE CASCADE,
  artikull_kodi text NOT NULL REFERENCES artikujt(kodi),
  sasia         integer NOT NULL,
  cmimi         numeric(10,2) NOT NULL
);
CREATE INDEX fatura_rreshtat_fatura ON fatura_rreshtat (fatura_id);

-- Orders received from the AI assistant, typed in by staff with our reference "AI-<number>".
CREATE TABLE porosi_hyrese (
  id         serial PRIMARY KEY,
  ref        text NOT NULL UNIQUE,
  klient_id  integer REFERENCES klientet(id),
  data       timestamptz NOT NULL DEFAULT now(),
  statusi    text NOT NULL DEFAULT 'ne pritje'       -- ne pritje | konfirmuar | ne pergatitje | dorezuar | anuluar
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Products: ~1500 rows from 28 active ingredients x dose/form variants x 8 fictional manufacturers x pack sizes.
-- Many share "500mg"; several paracetamol / ibuprofen / amoxicillin variants.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TEMP TABLE _ing (nr int, principi text, kategoria text, variante text[]);
INSERT INTO _ing VALUES
  ( 1, 'Paracetamol',          'Analgjezik',      ARRAY['500mg tableta','1000mg tableta','500mg tableta efervescente','120mg/5ml shurup','250mg supozitore']),
  ( 2, 'Ibuprofen',            'Anti-inflamator', ARRAY['200mg tableta','400mg tableta','600mg tableta','100mg/5ml shurup','5% xhel']),
  ( 3, 'Amoxicillin',          'Antibiotik',      ARRAY['250mg kapsula','500mg kapsula','1000mg tableta','250mg/5ml suspension']),
  ( 4, 'Amoxicillin + Acid klavulanik', 'Antibiotik', ARRAY['625mg tableta','1000mg tableta','457mg/5ml suspension']),
  ( 5, 'Metformin',            'Antidiabetik',    ARRAY['500mg tableta','850mg tableta','1000mg tableta']),
  ( 6, 'Ciprofloxacin',        'Antibiotik',      ARRAY['250mg tableta','500mg tableta','750mg tableta']),
  ( 7, 'Azithromycin',         'Antibiotik',      ARRAY['250mg tableta','500mg tableta','200mg/5ml suspension']),
  ( 8, 'Naproxen',             'Anti-inflamator', ARRAY['250mg tableta','500mg tableta']),
  ( 9, 'Diclofenac',           'Anti-inflamator', ARRAY['50mg tableta','75mg/3ml ampula','1% xhel','100mg supozitore']),
  (10, 'Omeprazol',            'Gastroenterologji', ARRAY['20mg kapsula','40mg kapsula']),
  (11, 'Pantoprazol',          'Gastroenterologji', ARRAY['20mg tableta','40mg tableta','40mg ampula']),
  (12, 'Amlodipine',           'Kardiovaskular',  ARRAY['5mg tableta','10mg tableta']),
  (13, 'Atorvastatin',         'Kardiovaskular',  ARRAY['10mg tableta','20mg tableta','40mg tableta']),
  (14, 'Losartan',             'Kardiovaskular',  ARRAY['50mg tableta','100mg tableta']),
  (15, 'Bisoprolol',           'Kardiovaskular',  ARRAY['2.5mg tableta','5mg tableta','10mg tableta']),
  (16, 'Levothyroxine',        'Endokrinologji',  ARRAY['25mcg tableta','50mcg tableta','100mcg tableta']),
  (17, 'Cetirizine',           'Antihistaminik',  ARRAY['10mg tableta','5mg/5ml shurup']),
  (18, 'Loratadine',           'Antihistaminik',  ARRAY['10mg tableta','5mg/5ml shurup']),
  (19, 'Metronidazole',        'Antibiotik',      ARRAY['250mg tableta','500mg tableta','500mg/100ml solucion']),
  (20, 'Clarithromycin',       'Antibiotik',      ARRAY['250mg tableta','500mg tableta']),
  (21, 'Cefuroxime',           'Antibiotik',      ARRAY['250mg tableta','500mg tableta','750mg ampula']),
  (22, 'Vitamina C',           'Vitamina',        ARRAY['500mg tableta','1000mg tableta efervescente']),
  (23, 'Vitamina D3',          'Vitamina',        ARRAY['1000IU kapsula','2000IU kapsula','400IU/ml pika']),
  (24, 'Magnez',               'Vitamina',        ARRAY['250mg tableta','375mg tableta efervescente']),
  (25, 'Salbutamol',           'Respirator',      ARRAY['100mcg inhalator','2mg tableta']),
  (26, 'Ambroxol',             'Respirator',      ARRAY['30mg tableta','15mg/5ml shurup']),
  (27, 'Levetiracetam',        'Neurologji',      ARRAY['500mg tableta','1000mg tableta']),
  (28, 'Sertraline',           'Neurologji',      ARRAY['50mg tableta','100mg tableta']);

INSERT INTO artikujt (kodi, emertimi, principi_aktiv, forma, doza, prodhuesi, cmimi, sasia, kategoria, skadenca, aktiv)
SELECT 'ART' || lpad(g::text, 5, '0'),
       i.principi || ' ' || v.variant ||
         CASE WHEN v.variant ~ '(tableta|kapsula|supozitore|ampula)' THEN ' x' || p.pack ELSE '' END ||
         ' - ' || p.prodhuesi,
       i.principi,
       substr(v.variant, length(split_part(v.variant, ' ', 1)) + 2),
       split_part(v.variant, ' ', 1),
       p.prodhuesi,
       (90 + (g * 37) % 1900)::numeric,
       CASE WHEN g % 17 = 0 THEN 0 ELSE (g * 13) % 400 + 5 END,
       i.kategoria,
       current_date + ((g * 29) % 900 + 30),
       g % 97 <> 0
FROM generate_series(1, 1500) AS g
JOIN _ing i ON i.nr = 1 + (g - 1) % 28
CROSS JOIN LATERAL (SELECT i.variante[1 + ((g - 1) / 28) % array_length(i.variante, 1)] AS variant) v
CROSS JOIN LATERAL (
  SELECT (ARRAY['Arbër Pharma','Drini Lab','Vjosa Med','Tomori Farma','Butrint Lab','Dajti Pharm','Osumi Med','Shkumbini Lab'])
           [1 + ((g - 1) / 84) % 8] AS prodhuesi,
         (ARRAY[10, 20, 30, 50, 100])[1 + ((g - 1) / 7) % 5] AS pack
) p;

-- ---------------------------------------------------------------------------------------------------------------------
-- 40 pharmacies. Phone n (9 digits) = 6900010NN; written in messy formats on purpose.
-- #38 has no phone; #39 and #40 share one phone (a family owning two pharmacies) -> must NOT be identified.
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO klientet (id, emri, nipt, adresa, qyteti, tel, email, borxhi, limiti_kredise, aktiv)
SELECT k,
       'Farmacia ' || (ARRAY['Agimi','Shpresa','Qendra','Lulishtja','Dielli','Ylli','Kalaja','Ura','Bregu','Liqeni',
                             'Pishat','Vreshtat','Ullishtja','Kodra','Fusha','Lumi','Mali','Deti','Stacioni','Tregu',
                             'Rinia','Miqësia','Shëndeti','Jeta','Drita','Kroi','Burimi','Pylli','Kopshti','Sheshi',
                             'Porta','Kalldrëmi','Ura e Gurit','Qafa','Lagjja e Re','Kryqëzimi','Arka','Fara','Bleta','Bleta 2'])[k],
       'X' || lpad((10000000 + k * 7919)::text, 8, '0') || chr(65 + k % 26),
       'Rruga ' || (ARRAY['e Durrësit','Myslym Shyri','e Kavajës','Dibrës','Elbasanit','Kongresi','Skënderbeu','Pavarësia'])[1 + k % 8] ||
         ', Nr. ' || (k * 3 % 120 + 1),
       (ARRAY['Tiranë','Durrës','Shkodër','Elbasan','Vlorë','Korçë','Fier','Berat','Lushnjë','Kavajë'])[1 + k % 10],
       CASE
         WHEN k = 38 THEN NULL
         WHEN k = 39 THEN '069 000 9999'
         WHEN k = 40 THEN '+355690009999'
         ELSE (SELECT CASE k % 6
                 WHEN 1 THEN '0' || substr(n, 1, 2) || ' ' || substr(n, 3, 2) || ' ' || substr(n, 5, 2) || ' ' || substr(n, 7, 3)
                 WHEN 2 THEN '+355' || n
                 WHEN 3 THEN '0' || n
                 WHEN 4 THEN '00355 ' || substr(n, 1, 2) || ' ' || substr(n, 3, 3) || ' ' || substr(n, 6, 4)
                 WHEN 5 THEN '355-' || substr(n, 1, 2) || '-' || substr(n, 3, 3) || '-' || substr(n, 6, 4)
                 ELSE '(0' || substr(n, 1, 2) || ') ' || substr(n, 3, 3) || '-' || substr(n, 6, 4)
               END FROM (SELECT '6900010' || lpad(k::text, 2, '0') AS n) x)
       END,
       'farmacia' || k || '@example.test',
       ((k * 15485) % 250000)::numeric,
       CASE WHEN k % 5 = 0 THEN 500000 ELSE 300000 END,
       k <> 37   -- #37 is a closed account
FROM generate_series(1, 40) AS k;
SELECT setval(pg_get_serial_sequence('klientet', 'id'), 40);

-- ---------------------------------------------------------------------------------------------------------------------
-- Invoices: 8 per pharmacy over the last ~6 months, 2-4 lines each, totals from the lines.
-- ---------------------------------------------------------------------------------------------------------------------
INSERT INTO faturat (nr, klient_id, data, statusi)
SELECT 'F-' || to_char(current_date, 'YYYY') || '-' || lpad(((k - 1) * 8 + j)::text, 5, '0'),
       k,
       current_date - (j * 21 + k % 9),
       CASE WHEN j <= 2 AND k % 3 = 0 THEN 'e papaguar' WHEN j = 1 AND k % 4 = 0 THEN 'pjeserisht' ELSE 'paguar' END
FROM generate_series(1, 40) AS k, generate_series(1, 8) AS j;

INSERT INTO fatura_rreshtat (fatura_id, artikull_kodi, sasia, cmimi)
SELECT f.id, a.kodi, 1 + (f.id * l) % 20, a.cmimi
FROM faturat f
CROSS JOIN generate_series(1, 4) AS l
JOIN artikujt a ON a.kodi = 'ART' || lpad((1 + (f.id * 131 + l * 977) % 1500)::text, 5, '0')
WHERE l <= 2 + f.id % 3;

UPDATE faturat f SET totali = s.t
FROM (SELECT fatura_id, sum(sasia * cmimi) AS t FROM fatura_rreshtat GROUP BY fatura_id) s
WHERE s.fatura_id = f.id;

DROP TABLE _ing;
COMMIT;

-- ---------------------------------------------------------------------------------------------------------------------
-- SELECT-only role for the app (roles are cluster-wide: create once, then just reset the password).
-- ---------------------------------------------------------------------------------------------------------------------
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_reader') AS need_role \gset
\if :need_role
  CREATE ROLE pharma_reader LOGIN PASSWORD :'reader_password';
\else
  ALTER ROLE pharma_reader LOGIN PASSWORD :'reader_password';
\endif
ALTER ROLE pharma_reader SET default_transaction_read_only = on;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE pharma_test TO pharma_reader;
GRANT USAGE ON SCHEMA public TO pharma_reader;
GRANT SELECT ON klientet, artikujt, faturat, fatura_rreshtat, porosi_hyrese TO pharma_reader;

SELECT (SELECT count(*) FROM artikujt) AS artikuj,
       (SELECT count(*) FROM artikujt WHERE emertimi ILIKE '%500mg%') AS me_500mg,
       (SELECT count(*) FROM artikujt WHERE emertimi ILIKE 'paracetamol 500mg%') AS paracetamol_500mg,
       (SELECT count(*) FROM klientet) AS farmaci,
       (SELECT count(*) FROM faturat) AS fatura,
       (SELECT count(*) FROM fatura_rreshtat) AS rreshta;
