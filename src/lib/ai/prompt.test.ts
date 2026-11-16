// Pure test of the system prompt: no DB, no API. Run: npx tsx --test src/lib/ai/prompt.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "@/lib/ai/prompt";

const shop = { name: "Demo", currency: "ALL", defaultLanguage: "sq" as const, aiInstructions: "" };

test("the prompt keeps the order, use-case and safety rules", () => {
  const p = buildSystemPrompt(shop);
  for (const rule of ["never trust earlier chat text", "# Use cases", "127 or 112", "immediately preceding message", "Never call create_order twice", "# Safety"]) {
    assert.ok(p.toLowerCase().includes(rule.toLowerCase()), `missing: ${rule}`);
  }
});

test("the prompt is deterministic per shop (prompt cache) and carries owner instructions inside their own block", () => {
  assert.equal(buildSystemPrompt(shop), buildSystemPrompt({ ...shop }));
  const p = buildSystemPrompt({ ...shop, aiInstructions: "Dergesa falas mbi 5000 leke" });
  assert.match(p, /<shop_instructions>\nDergesa falas mbi 5000 leke\n<\/shop_instructions>/);
});
