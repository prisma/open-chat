// Spend gating and usage recording.
//
// Guests get a small lifetime budget tracked purely from Usage rows.
// Signed-in accounts are credit-based: $2 on signup, paid top-ups, and a
// free $0.50 drip after a month at zero — see src/server/billing.ts.
import type { UsageSummary } from "../shared/contracts";
import { GUEST_LIMIT_MICRO_USD } from "../shared/billing";
import { db } from "../prisma/db";
import {
  getCreditSummary,
  markZeroIfDrained,
  maybeGrantFreeTopup,
} from "./billing";
import { HttpError } from "./http";
import { getModelPricing } from "./openrouter";

export type SpendUser = {
  id: string;
  isAnonymous?: boolean | null | undefined;
};

export function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export async function getGuestSpendMicroUsd(userId: string) {
  // Guest budgets are lifetime, not monthly: sum every period.
  const totals = await db.orm.Usage.where({ userId }).aggregate(
    (aggregate) => ({ cost: aggregate.sum("costMicroUsd") }),
  );
  return totals.cost ?? 0;
}

export async function assertWithinUsageLimit(user: SpendUser) {
  if (user.isAnonymous) {
    const spent = await getGuestSpendMicroUsd(user.id);
    if (spent < GUEST_LIMIT_MICRO_USD) return;
    throw new HttpError(
      402,
      "Free guest budget used up. Create an account to get $2.00 in credit.",
    );
  }

  const summary = await getCreditSummary(user.id);
  if (summary.balanceMicroUsd > 0) return;

  // At zero — the free monthly drip may have come due since the last check.
  if (await maybeGrantFreeTopup(user.id)) return;

  throw new HttpError(
    402,
    "You're out of credits. Top up to keep chatting.",
  );
}

// OpenRouter chat streams report `promptTokens`/`completionTokens`; keep
// accepting `inputTokens`/`outputTokens` so older events still summarize.
type StreamUsage = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  promptTokens?: number | undefined;
  completionTokens?: number | undefined;
  cost?: number | null | undefined;
};

export async function summarizeUsage(
  model: string,
  usage: StreamUsage | undefined,
): Promise<UsageSummary> {
  const inputTokens = Math.max(
    0,
    Math.round(usage?.inputTokens ?? usage?.promptTokens ?? 0),
  );
  const outputTokens = Math.max(
    0,
    Math.round(usage?.outputTokens ?? usage?.completionTokens ?? 0),
  );

  // OpenRouter reports the authoritative cost in USD when usage accounting
  // is enabled; fall back to the model's published per-token pricing.
  let costUsd = usage?.cost ?? null;
  if (costUsd == null) {
    const pricing = await getModelPricing(model).catch(() => undefined);
    costUsd = pricing
      ? inputTokens * pricing.prompt + outputTokens * pricing.completion
      : 0;
  }

  // Round up so we never undercount against the budget.
  const costMicroUsd = Math.max(0, Math.ceil(costUsd * 1_000_000));
  return { inputTokens, outputTokens, costMicroUsd };
}

export async function summarizeSpeechUsage(
  model: string,
  text: string,
): Promise<UsageSummary> {
  const inputTokens = text.length;
  const pricing = await getModelPricing(model).catch(() => undefined);
  const costUsd = pricing ? inputTokens * pricing.prompt : 0;
  return {
    // TTS pricing is per input character. Reuse the existing usage shape so
    // billing and stats keep one accounting path.
    inputTokens,
    outputTokens: 0,
    costMicroUsd: Math.max(0, Math.ceil(costUsd * 1_000_000)),
  };
}

export async function recordUsage(user: SpendUser, usage: UsageSummary) {
  const period = currentPeriod();
  const existing = await db.orm.Usage.where({ userId: user.id, period })
    .first();

  if (existing) {
    await db.orm.Usage.where({ id: existing.id }).update({
      inputTokens: existing.inputTokens + usage.inputTokens,
      outputTokens: existing.outputTokens + usage.outputTokens,
      costMicroUsd: existing.costMicroUsd + usage.costMicroUsd,
      updatedAt: new Date(),
    });
  } else {
    const now = new Date();
    await db.orm.Usage.create({
      id: `usage_${crypto.randomUUID()}`,
      userId: user.id,
      period,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicroUsd: usage.costMicroUsd,
      createdAt: now,
      updatedAt: now,
    });
  }

  // If this spend drained the account, start the free top-up clock.
  if (!user.isAnonymous) await markZeroIfDrained(user.id);
}
