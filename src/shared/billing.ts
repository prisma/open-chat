// Billing math shared by the server (Stripe checkout, credit gating) and
// the client (rendering the same numbers the server will charge). Keeping
// one source of truth is what makes the 10% fee transparent rather than a
// surprise on the Stripe page.

export const MICRO_USD_PER_USD = 1_000_000;

/** Credit granted to every signed-in account, once. */
export const SIGNUP_CREDIT_MICRO_USD = 2 * MICRO_USD_PER_USD;

/** Lifetime budget for anonymous guests. */
export const GUEST_LIMIT_MICRO_USD = 500_000;

/** Free credit dripped to accounts that have sat at $0 for a month. */
export const FREE_TOPUP_MICRO_USD = 500_000;
export const FREE_TOPUP_WAIT_DAYS = 30;

/** The fixed top-up amounts users can buy, in whole USD. */
export const TOPUP_OPTIONS_USD = [5, 10, 20, 50, 100] as const;
export type TopupOptionUsd = (typeof TOPUP_OPTIONS_USD)[number];

/** Fee charged on top of the credit amount, covering Stripe + OpenRouter. */
export const TOPUP_FEE_PERCENT = 10;

export type TopupQuote = {
  creditMicroUsd: number;
  feeMicroUsd: number;
  totalMicroUsd: number;
};

export function isTopupOption(value: number): value is TopupOptionUsd {
  return (TOPUP_OPTIONS_USD as readonly number[]).includes(value);
}

/** What a top-up costs: the chosen credit plus the 10% fee. */
export function quoteTopup(amountUsd: TopupOptionUsd): TopupQuote {
  const creditMicroUsd = amountUsd * MICRO_USD_PER_USD;
  const feeMicroUsd = (creditMicroUsd * TOPUP_FEE_PERCENT) / 100;
  return {
    creditMicroUsd,
    feeMicroUsd,
    totalMicroUsd: creditMicroUsd + feeMicroUsd,
  };
}

/** When a balance that hit zero at `zeroAt` earns the free top-up. */
export function freeTopupDueAt(zeroAt: Date): Date {
  return new Date(
    zeroAt.getTime() + FREE_TOPUP_WAIT_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function isFreeTopupDue(zeroAt: Date, now = new Date()): boolean {
  return now.getTime() >= freeTopupDueAt(zeroAt).getTime();
}
