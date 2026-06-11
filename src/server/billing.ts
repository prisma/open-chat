// Credit accounting and Stripe top-ups for signed-in users.
//
// The balance is never stored: it is the sum of the CreditGrant ledger
// minus lifetime Usage cost. Grants are idempotent — the signup grant and
// free drips use deterministic ids, paid top-ups dedupe on the unique
// Stripe session id — so retries, webhook/redirect races, and reloads
// cannot double-credit.
import Stripe from "stripe";
import {
  FREE_TOPUP_MICRO_USD,
  SIGNUP_CREDIT_MICRO_USD,
  freeTopupDueAt,
  isFreeTopupDue,
  quoteTopup,
  type TopupOptionUsd,
} from "../shared/billing";
import { db } from "../prisma/db";
import { env } from "./env";
import { HttpError } from "./http";

let stripeClient: Stripe | undefined;

function getStripe() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new HttpError(503, "Billing is not configured on this server");
  }
  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
}

export async function ensureBilling(userId: string) {
  const existing = await db.orm.Billing.where({ userId }).first();
  if (existing) return existing;

  const now = new Date();
  // Deterministic ids make both inserts idempotent under concurrent
  // requests; a unique-violation just means the other request won.
  await db.orm.CreditGrant.create({
    id: `grant_signup_${userId}`,
    userId,
    kind: "signup",
    creditMicroUsd: SIGNUP_CREDIT_MICRO_USD,
    feeMicroUsd: 0,
    paidMicroUsd: 0,
    stripeSessionId: null,
    createdAt: now,
  }).catch(() => undefined);
  await db.orm.Billing.create({
    id: `billing_${userId}`,
    userId,
    zeroAt: null,
    createdAt: now,
  }).catch(() => undefined);

  const billing = await db.orm.Billing.where({ userId }).first();
  if (!billing) throw new Error("Failed to initialize billing");
  return billing;
}

async function grantedMicroUsd(userId: string) {
  const totals = await db.orm.CreditGrant.where({ userId }).aggregate(
    (aggregate) => ({ credit: aggregate.sum("creditMicroUsd") }),
  );
  return totals.credit ?? 0;
}

async function lifetimeSpendMicroUsd(userId: string) {
  const totals = await db.orm.Usage.where({ userId }).aggregate(
    (aggregate) => ({ cost: aggregate.sum("costMicroUsd") }),
  );
  return totals.cost ?? 0;
}

export type CreditSummary = {
  grantedMicroUsd: number;
  spentMicroUsd: number;
  balanceMicroUsd: number;
  /** When the free $0.50 top-up unlocks, if the balance is empty. */
  freeTopupAt: Date | null;
};

export async function getCreditSummary(
  userId: string,
): Promise<CreditSummary> {
  const billing = await ensureBilling(userId);
  const [granted, spent] = await Promise.all([
    grantedMicroUsd(userId),
    lifetimeSpendMicroUsd(userId),
  ]);

  return {
    grantedMicroUsd: granted,
    spentMicroUsd: spent,
    balanceMicroUsd: granted - spent,
    freeTopupAt: billing.zeroAt ? freeTopupDueAt(billing.zeroAt) : null,
  };
}

/** Record that the balance hit zero, starting the free top-up clock. */
export async function markZeroIfDrained(userId: string) {
  const billing = await ensureBilling(userId);
  if (billing.zeroAt) return;

  const [granted, spent] = await Promise.all([
    grantedMicroUsd(userId),
    lifetimeSpendMicroUsd(userId),
  ]);
  if (granted - spent > 0) return;

  await db.orm.Billing.where({ id: billing.id }).update({ zeroAt: new Date() });
}

/**
 * Grant the free $0.50 if the account has been at zero for a month.
 * Returns true when credit was added (or had already been added for this
 * zero-event by a concurrent request).
 */
export async function maybeGrantFreeTopup(userId: string) {
  const billing = await ensureBilling(userId);
  if (!billing.zeroAt || !isFreeTopupDue(billing.zeroAt)) return false;

  // One drip per zero-event: the id encodes when the balance ran out.
  await db.orm.CreditGrant.create({
    id: `grant_drip_${userId}_${billing.zeroAt.getTime()}`,
    userId,
    kind: "free-topup",
    creditMicroUsd: FREE_TOPUP_MICRO_USD,
    feeMicroUsd: 0,
    paidMicroUsd: 0,
    stripeSessionId: null,
    createdAt: new Date(),
  }).catch(() => undefined);
  await db.orm.Billing.where({ id: billing.id }).update({ zeroAt: null });
  return true;
}

export async function createTopupCheckout(
  user: { id: string; email: string },
  amountUsd: TopupOptionUsd,
) {
  const stripe = getStripe();
  const quote = quoteTopup(amountUsd);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    // Explicit instead of dashboard-managed, so checkout works on a fresh
    // Stripe account without further configuration.
    payment_method_types: ["card"],
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: quote.creditMicroUsd / 10_000, // µ$ → cents
          product_data: {
            name: `Open Chat credit — $${amountUsd}.00`,
          },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: quote.feeMicroUsd / 10_000,
          product_data: {
            name: "Service fee (10%)",
            description: "Covers Stripe and OpenRouter fees",
          },
        },
      },
    ],
    metadata: {
      userId: user.id,
      creditMicroUsd: String(quote.creditMicroUsd),
      feeMicroUsd: String(quote.feeMicroUsd),
    },
    success_url: `${env.APP_ORIGIN}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.APP_ORIGIN}/?billing=cancelled`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url, quote };
}

async function creditPaidSession(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  const creditMicroUsd = Number(session.metadata?.creditMicroUsd);
  const feeMicroUsd = Number(session.metadata?.feeMicroUsd ?? 0);

  if (!userId || !Number.isFinite(creditMicroUsd) || creditMicroUsd <= 0) {
    throw new HttpError(400, "Checkout session is missing credit metadata");
  }
  if (session.payment_status !== "paid") {
    throw new HttpError(402, "Checkout session has not been paid");
  }

  const existing = await db.orm.CreditGrant.where({
    stripeSessionId: session.id,
  }).first();
  if (existing) return { userId, creditMicroUsd, alreadyCredited: true };

  // The unique stripeSessionId makes a concurrent webhook/redirect race
  // resolve to a single grant.
  await db.orm.CreditGrant.create({
    id: `grant_topup_${crypto.randomUUID()}`,
    userId,
    kind: "topup",
    creditMicroUsd,
    feeMicroUsd,
    paidMicroUsd: (session.amount_total ?? 0) * 10_000, // cents → µ$
    stripeSessionId: session.id,
    createdAt: new Date(),
  }).catch(async () => {
    const winner = await db.orm.CreditGrant.where({
      stripeSessionId: session.id,
    }).first();
    if (!winner) throw new Error("Failed to record top-up");
  });

  // Balance is positive again; reset the free top-up clock.
  await db.orm.Billing.where({ userId }).update({ zeroAt: null });
  return { userId, creditMicroUsd, alreadyCredited: false };
}

/** Redirect-back path: the signed-in user returns with a session id. */
export async function confirmTopup(userId: string, sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.metadata?.userId !== userId) {
    throw new HttpError(403, "This checkout session belongs to another user");
  }
  const result = await creditPaidSession(session);
  return { creditMicroUsd: result.creditMicroUsd };
}

/** Webhook path: credits even if the user never returns to the app. */
export async function handleStripeWebhook(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new HttpError(501, "Stripe webhook secret is not configured");
  }
  const stripe = getStripe();
  const signature = request.headers.get("stripe-signature");
  if (!signature) throw new HttpError(400, "Missing stripe-signature header");

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    throw new HttpError(400, "Invalid webhook signature");
  }

  if (event.type === "checkout.session.completed") {
    await creditPaidSession(event.data.object);
  }
  return { received: true };
}
