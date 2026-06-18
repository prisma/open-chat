// Account and app-info routes: the current user, client config, usage and
// credit balances, and the OpenRouter model catalog.
import {
  type ConfigDto,
  type UsageDto,
} from "../../shared/contracts";
import { GUEST_LIMIT_MICRO_USD } from "../../shared/billing";
import { configuredSocialProviders } from "../auth";
import { getCreditSummary } from "../billing";
import { env } from "../env";
import { assertMethod, gzipJson, json, requireUser } from "../http";
import { listOpenRouterModels } from "../openrouter";
import { getGuestSpendMicroUsd } from "../usage";

export async function listModels(request: Request) {
  assertMethod(request, ["GET"]);
  await requireUser(request);
  // The catalog changes rarely; let the browser skip the refetch for a while.
  return gzipJson(request, await listOpenRouterModels(), {
    "Cache-Control": "private, max-age=300",
  });
}

export async function getMe(request: Request) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  return json({
    id: user.id,
    name: user.name,
    email: user.email,
  });
}

export async function getUsage(request: Request) {
  assertMethod(request, ["GET"]);
  const user = await requireUser(request);
  const isAnonymous = Boolean(
    (user as { isAnonymous?: boolean | null }).isAnonymous,
  );

  if (isAnonymous) {
    const dto: UsageDto = {
      isAnonymous: true,
      spentMicroUsd: await getGuestSpendMicroUsd(user.id),
      limitMicroUsd: GUEST_LIMIT_MICRO_USD,
    };
    return json(dto);
  }

  const summary = await getCreditSummary(user.id);
  const dto: UsageDto = {
    isAnonymous: false,
    spentMicroUsd: summary.spentMicroUsd,
    grantedMicroUsd: summary.grantedMicroUsd,
    balanceMicroUsd: summary.balanceMicroUsd,
    freeTopupAt: summary.freeTopupAt?.toISOString() ?? null,
  };
  return json(dto);
}

export function getConfig(request: Request) {
  assertMethod(request, ["GET"]);
  const streamsUrl =
    env.STREAMS_URL || `http://127.0.0.1:${env.STREAMS_PORT}`;
  const dto: ConfigDto = {
    socialProviders: configuredSocialProviders(),
    billingEnabled: Boolean(env.STRIPE_SECRET_KEY),
    streamsRemote: Boolean(env.STREAMS_URL),
    streamsOrigin: new URL(streamsUrl).origin,
  };
  return json(dto);
}
