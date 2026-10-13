import pLimit from "p-limit";
import type { ZodType } from "zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AI_MODEL, AI_PRICE_PER_MILLION_TOKENS } from "../lib/config";
import { addUsage, aiBudgetLeftToday, aiCallsLeftToday } from "../lib/usage";

/** AI calls in flight across all runs. */
const aiSlots = pLimit(6);

export class AiBudgetError extends Error {}

interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

/** Estimated USD cost of one call at list price; reasoning tokens are included in completion_tokens. */
function callCostUsd(usage: TokenUsage | undefined, promptChars: number, maxTokens: number): number {
  const price = AI_PRICE_PER_MILLION_TOKENS;
  // No usage reported: assume the most the call could have cost so the budget stays conservative.
  if (!usage) return ((promptChars / 4) * price.input + maxTokens * price.output) / 1e6;
  const prompt = usage.prompt_tokens ?? 0;
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  return ((prompt - cached) * price.input + cached * price.cachedInput + output * price.output) / 1e6;
}

export interface StructuredCall<T> {
  /** Schema name sent to the model (letters, digits, underscores). */
  name: string;
  /** Strict JSON Schema: every property required, additionalProperties false. */
  jsonSchema: Record<string, unknown>;
  /** Validates the model output again on our side. */
  parser: ZodType<T>;
  system: string;
  user: string;
  maxTokens?: number;
}

/** One structured-output call to the model through Replit AI Integrations, counted against the daily caps. */
export async function structuredCall<T>(call: StructuredCall<T>): Promise<T> {
  return aiSlots(async () => {
    // Checked inside the slot so calls waiting in the queue can't all pass at once and overshoot the budget.
    if ((await aiCallsLeftToday()) <= 0 || (await aiBudgetLeftToday()) <= 0) {
      throw new AiBudgetError("Daily AI budget reached");
    }
    await addUsage({ aiCalls: 1 });
    const maxTokens = call.maxTokens ?? 6000;
    const completion = await openai.chat.completions.create(
      {
        model: AI_MODEL,
        reasoning_effort: "low",
        max_completion_tokens: maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name: call.name, strict: true, schema: call.jsonSchema },
        },
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
      },
      { timeout: 60_000, maxRetries: 2 },
    );
    await addUsage({ aiCostUsd: callCostUsd(completion.usage, call.system.length + call.user.length, maxTokens) });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error(`AI returned no content (finish reason: ${completion.choices[0]?.finish_reason ?? "none"})`);
    return call.parser.parse(JSON.parse(content));
  });
}

/** Plain-language description of the seeker, shared by the extraction and matching prompts. */
export function describeSeeker(prefs: {
  roles: string[];
  seniority: string[];
  locations: string[];
  remoteOk: boolean;
  opportunityTypes: string[];
  citizenship: string | null;
  needsVisaSponsorship: boolean;
  funding: string;
  keywords: string[];
}): string {
  const early = prefs.seniority.some((s) => s !== "experienced");
  const lines = [
    `Profile: ${early ? "university student or recent graduate" : "working professional"}`,
    `Roles: ${prefs.roles.join("; ")}`,
    `Level: ${prefs.seniority.join(", ").replace(/_/g, " ")}`,
    `Places: ${prefs.locations.length ? prefs.locations.join(", ") : "anywhere"}${
      prefs.remoteOk ? " (remote is fine)" : prefs.locations.length ? " (no remote roles unless based in these places)" : ""
    }`,
    `Looking for: ${prefs.opportunityTypes.map((t) => (t === "company_roles" ? "company jobs/internships" : "research or internship programs")).join(" and ")}`,
    `Citizenship: ${prefs.citizenship ?? "not given"}; needs visa sponsorship: ${prefs.needsVisaSponsorship ? "yes" : "no"}`,
    `Funding wanted: ${prefs.funding.replace(/_/g, " ")}`,
  ];
  if (prefs.keywords.length) lines.push(`Keywords: ${prefs.keywords.join(", ")}`);
  return lines.join("\n");
}
