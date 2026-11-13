/**
 * For plain-Node entry points only (node:test files, scripts/ai-*.ts) — never import from app code.
 * `server-only` throws outside the react-server condition; Next sets that condition, plain Node/tsx does not.
 * Import this module FIRST: it pre-seeds the CJS module cache with the package's own empty.js.
 */
import "dotenv/config";
import { createRequire } from "node:module";
import path from "node:path";

const req = createRequire(path.join(process.cwd(), "package.json"));
const throwing = req.resolve("server-only");
const empty = path.join(path.dirname(throwing), "empty.js");
req(empty);
req.cache[throwing] = req.cache[empty];
