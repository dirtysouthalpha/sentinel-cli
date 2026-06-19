/**
 * refineGoal — turn casual input into a well-structured loop goal.
 *
 * MODEL-INDEPENDENT by design: pure heuristics, zero API calls, zero latency.
 * Works on every provider (Z.ai/GLM, Claude, OpenAI, Ollama) and even weak
 * models, because the structuring happens before the agent ever sees the goal.
 *
 * The point: a user types "login form validation" and gets a goal that names
 * the verb, the scope, and a concrete done-condition — so the loop starts in
 * good shape regardless of which model runs it. The loop's own PLAN step can
 * still decompose further; this just gives it a clean runway.
 */

export interface Intent {
  /** Canonical intent name (also the keyword(s) to match). */
  name: string;
  /** Keywords that trigger this intent (lowercased). */
  keywords: string[];
  /** Build the refined goal from the cleaned raw input. */
  refine: (cleaned: string) => string;
}

/** Trim + collapse internal whitespace runs to single spaces. */
function clean(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

// Each intent injects a verb-appropriate done-condition + guardrail. These are
// short, concrete, and bias the loop toward small safe steps + a testable exit.
export const INTENTS: Intent[] = [
  {
    name: "fix",
    keywords: ["fix", "debug", "repair", "resolve"],
    refine: (c) =>
      `Fix ${c}. Reproduce the issue, diagnose the root cause, and fix it. ` +
      `Done when the original failure no longer occurs and no existing tests break.`,
  },
  {
    name: "implement",
    keywords: ["implement", "build", "create"],
    refine: (c) =>
      `Implement ${c}. Decompose into small, safe steps. ` +
      `Done when the feature works end-to-end and is covered by tests.`,
  },
  {
    name: "add",
    keywords: ["add", "insert"],
    refine: (c) =>
      `Add ${c}. Decompose into small, safe steps. ` +
      `Done when the addition is complete, lint+test pass, and it is covered by tests.`,
  },
  {
    name: "refactor",
    keywords: ["refactor", "restructure", "reorganize"],
    refine: (c) =>
      `Refactor ${c}. Decompose into small, safe steps. ` +
      `Preserve all existing behavior — no public signatures change. ` +
      `Done when lint+test pass and the code is simpler.`,
  },
  {
    name: "improve",
    keywords: ["improve", "enhance", "optimize", "speed up", "make faster"],
    refine: (c) =>
      `Improve ${c}. Measure before and after. ` +
      `Done when the improvement is demonstrable and lint+test pass.`,
  },
  {
    name: "clean",
    keywords: ["clean", "remove", "delete", "strip"],
    refine: (c) =>
      `Clean up ${c}. Delete dead/unused code only; never change behavior. ` +
      `Done when lint+test pass and the removed code is genuinely unreferenced.`,
  },
  {
    name: "document",
    keywords: ["document", "docs", "comment", "readme"],
    refine: (c) =>
      `Document ${c}. Write clear, concise docs/comments. ` +
      `Done when every public surface is documented and no code behavior changes.`,
  },
  {
    name: "secure",
    keywords: ["secure", "harden", "sanitize", "validate"],
    refine: (c) =>
      `Secure ${c}. Close the vulnerability at its root, not with a workaround. ` +
      `Done when the input is validated/sanitized at the trust boundary and covered by tests.`,
  },
  {
    name: "test",
    keywords: ["test", "tests", "cover", "coverage"],
    refine: (c) =>
      `Write tests for ${c}. Cover the happy path, edge cases, and failure modes. ` +
      `Done when the target has meaningful coverage and all new tests pass.`,
  },
];

/** Detect the matching intent. Leading verb wins; if none leads, fall back to
 *  the first keyword found anywhere in the phrase (word-boundary match). */
export function detectIntent(raw: string): string | null {
  const lower = " " + clean(raw).toLowerCase() + " ";
  // Pass 1: leading verb (strongest signal — "fix the bug" is clearly "fix").
  for (const intent of INTENTS) {
    for (const kw of intent.keywords) {
      if (lower.startsWith(" " + kw + " ")) return intent.name;
    }
  }
  // Pass 2: keyword anywhere as a whole word ("write tests for X" → "test").
  for (const intent of INTENTS) {
    for (const kw of intent.keywords) {
      if (lower.includes(" " + kw + " ")) return intent.name;
    }
  }
  return null;
}

export interface RefinedGoal {
  raw: string;
  refined: string;
  intent: string | null;
}

/**
 * Turn casual input into a structured loop goal. Always returns something
 * usable — never throws. When no intent matches, wraps the goal with a generic
 * structure and a default done-condition.
 */
export function refineGoal(input: string): RefinedGoal {
  const cleaned = clean(input);
  const raw = cleaned;
  const intentName = detectIntent(cleaned);
  const intent = intentName ? INTENTS.find((i) => i.name === intentName) : null;

  if (intent) {
    // Strip the leading keyword from the goal body so we don't get "Fix fix the bug".
    const body = stripLeadingKeyword(cleaned, intent);
    return { raw, refined: intent.refine(body), intent: intentName };
  }

  // Fallback: generic structure. Still gives the loop a done-condition.
  const fallback =
    `Work on: ${cleaned || "(unspecified goal — ask the user to clarify)"}. ` +
    `Decompose into small, safe steps. ` +
    `Done when lint+test pass and the change is complete.`;
  return { raw, refined: fallback, intent: null };
}

/** Remove the matched keyword from the start of the goal body. Returns the
 *  body as-is (lowercased articles preserved) — the template capitalizes. */
function stripLeadingKeyword(cleaned: string, intent: Intent): string {
  const lower = cleaned.toLowerCase();
  for (const kw of intent.keywords) {
    if (lower.startsWith(kw + " ")) {
      const rest = cleaned.slice(kw.length).trim();
      return rest.length > 0 ? rest : cleaned;
    }
  }
  return cleaned;
}
