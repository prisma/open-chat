import type { UsageSummary } from "../shared/contracts";
import { db } from "../prisma/db";
import { HttpError } from "./http";
import { getModelPricing } from "./openrouter";

export const ANONYMOUS_LIMIT_MICRO_USD = 500_000;
export const MONTHLY_LIMIT_MICRO_USD = 2_000_000;

export type SpendUser = {
  id: string;
  isAnonymous?: boolean | null | undefined;
};

export function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

export function limitMicroUsdFor(user: SpendUser) {
  return user.isAnonymous ? ANONYMOUS_LIMIT_MICRO_USD : MONTHLY_LIMIT_MICRO_USD;
}

export async function getSpendMicroUsd(user: SpendUser) {
  if (user.isAnonymous) {
    // Guest budgets are lifetime, not monthly: sum every period.
    const totals = await db.orm.Usage.where({ userId: user.id }).aggregate(
      (aggregate) => ({ cost: aggregate.sum("costMicroUsd") }),
    );
    return totals.cost ?? 0;
  }

  const row = await db.orm.Usage.where({
    userId: user.id,
    period: currentPeriod(),
  }).first();
  return row?.costMicroUsd ?? 0;
}

export async function assertWithinUsageLimit(user: SpendUser) {
  const spent = await getSpendMicroUsd(user);
  if (spent < limitMicroUsdFor(user)) return;

  throw new HttpError(
    402,
    user.isAnonymous
      ? "Free usage limit reached."
      : "Monthly usage limit reached. Top-ups are coming soon.",
  );
}

// OpenRouter streams report `promptTokens`/`completionTokens` (chat
// completions shape); the SDK's responses shape uses
// `inputTokens`/`outputTokens`. Accept both.
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

export async function recordUsage(userId: string, usage: UsageSummary) {
  const period = currentPeriod();
  const existing = await db.orm.Usage.where({ userId, period }).first();

  if (existing) {
    await db.orm.Usage.where({ id: existing.id }).update({
      inputTokens: existing.inputTokens + usage.inputTokens,
      outputTokens: existing.outputTokens + usage.outputTokens,
      costMicroUsd: existing.costMicroUsd + usage.costMicroUsd,
      updatedAt: new Date(),
    });
    return;
  }

  const now = new Date();
  await db.orm.Usage.create({
    id: `usage_${crypto.randomUUID()}`,
    userId,
    period,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costMicroUsd: usage.costMicroUsd,
    createdAt: now,
    updatedAt: now,
  });
}
