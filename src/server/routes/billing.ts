// Billing routes: Stripe top-up checkout, confirmation, and webhook.
//
// The credit math and Stripe calls live in server/billing.ts; these
// handlers only parse, authorize, and translate to HTTP.
import { topupCheckoutSchema } from "../../shared/contracts";
import { isTopupOption } from "../../shared/billing";
import {
  confirmTopup,
  createTopupCheckout,
  handleStripeWebhook,
} from "../billing";
import {
  HttpError,
  assertMethod,
  json,
  parseJson,
  requireUser,
} from "../http";

export async function createCheckout(request: Request) {
  assertMethod(request, ["POST"]);
  const user = await requireUser(request);
  if ((user as { isAnonymous?: boolean | null }).isAnonymous) {
    throw new HttpError(403, "Create an account to top up credits");
  }

  const input = topupCheckoutSchema.parse(await parseJson(request));
  if (!isTopupOption(input.amountUsd)) {
    throw new HttpError(400, "Unsupported top-up amount");
  }

  const checkout = await createTopupCheckout(
    { id: user.id, email: user.email },
    input.amountUsd,
  );
  return json({ url: checkout.url, quote: checkout.quote });
}

export async function confirmCheckout(request: Request) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) throw new HttpError(400, "session_id is required");

  return json(await confirmTopup(user.id, sessionId));
}

export async function stripeWebhook(request: Request) {
  assertMethod(request, ["POST"]);
  return json(await handleStripeWebhook(request));
}
