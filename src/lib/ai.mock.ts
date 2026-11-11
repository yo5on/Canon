// DEMO/MOCK stand-in for the Claude call, used only when CANON_AI_MOCK=1 is set explicitly
// (see src/app/api/items/[id]/analyze/route.ts). Runs are stored with model "mock" and the report says so.
// The fixed response targets MOCK_DRAFT and the Canon Demo Co. kit; it still goes through the real Zod schema,
// verifier and Claims Ledger, and includes one deliberately wrong quote to show the downgrade path.
import type { AiClient, ModelOutput } from "./ai";
import { normalize } from "./verifier";

export const MOCK_PROMPT_VERSION = "canon-demo-v2";

export const MOCK_DRAFT =
  "Canon Demo Co. now serves more than 5,000 customers and is the fastest-growing platform in India. " +
  "Our revolutionary dashboard helps users ship campaigns in minutes. " +
  "Trusted by over 1,000 customers — you'll wonder how you ever worked without it. " +
  "Rated 4.8 out of 5 by customers, and now available in 12 countries.";

const RESPONSE: ModelOutput = {
  findings: [
    {
      source_id: "TONE-1",
      source_quote: "no hype words",
      draft_quote: "revolutionary dashboard",
      category: "tone",
      confidence: 0.86,
      explanation: "“Revolutionary” is a hype word; the voice guide asks for confident, plain language.",
      fix: { replace: "Our revolutionary dashboard", with: "Our dashboard" },
    },
    {
      source_id: "TONE-1",
      source_quote: "avoid exaggerated speed promises",
      draft_quote: "ship campaigns in minutes",
      category: "tone",
      confidence: 0.55,
      explanation: "“In minutes” may overstate speed.",
      fix: null,
    },
  ],
  claims: [
    { text: "serves more than 5,000 customers", type: "number", candidates: [{ fact_id: "FACT-1", relation: "CONTRADICTS", quote: "serves 1,200 customers" }] },
    { text: "the fastest-growing platform in India", type: "superlative", candidates: [] },
    { text: "Trusted by over 1,000 customers", type: "number", candidates: [{ fact_id: "FACT-1", relation: "ENTAILS", quote: "serves 1,200 customers" }] },
    { text: "you'll wonder how you ever worked without it", type: "opinion", candidates: [] },
    // FACT-2 expired before any future publish date → OUTDATED
    { text: "Rated 4.8 out of 5 by customers", type: "number", candidates: [{ fact_id: "FACT-2", relation: "ENTAILS", quote: "rated 4.8 out of 5" }] },
    // the quote is not in FACT-3 → HUMAN_JUDGEMENT
    { text: "now available in 12 countries", type: "number", candidates: [{ fact_id: "FACT-3", relation: "ENTAILS", quote: "available in 12 countries" }] },
  ],
};

// shortcut: recognises only the sample phrases; use a real provider for general draft analysis.
export const createMockClient = (draft: string) => ({
  messages: {
    create: async () => ({
      content: [{ type: "text", text: JSON.stringify({
        findings: RESPONSE.findings.filter((f) => normalize(draft).includes(normalize(f.draft_quote))),
        claims: RESPONSE.claims.filter((c) => normalize(draft).includes(normalize(c.text))),
      }) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0 },
    }),
  },
}) as unknown as AiClient;
