import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { db, pool } from "../prisma/db";
import service from "../service";
import { appendMessageEvent, loadAllMessageEvents } from "./streams";

// Social sign-in is off in this topology (the service declares no OAuth
// secrets); providers light up only if credentials appear in the plain
// environment. The client asks /api/config which ones to offer.
const githubClientId = process.env["GITHUB_CLIENT_ID"];
const githubClientSecret = process.env["GITHUB_CLIENT_SECRET"];
const googleClientId = process.env["GOOGLE_CLIENT_ID"];
const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];

const socialProviders = {
  ...(githubClientId && githubClientSecret
    ? {
        github: {
          clientId: githubClientId,
          clientSecret: githubClientSecret,
        },
      }
    : {}),
  ...(googleClientId && googleClientSecret
    ? {
        google: {
          clientId: googleClientId,
          clientSecret: googleClientSecret,
        },
      }
    : {}),
};

export function configuredSocialProviders() {
  return Object.keys(socialProviders);
}

// When a guest signs up (email or social), Better Auth links the accounts
// and then deletes the anonymous user — which would cascade-delete their
// chats. Move the chats and replay their durable events into the new
// user's stream first, so nothing is lost by creating an account.
async function migrateGuestData(anonymousUserId: string, newUserId: string) {
  const chats = await db.orm.public.Chat.where({ userId: anonymousUserId }).all();

  for (const chat of chats) {
    const { events } = await loadAllMessageEvents(anonymousUserId, chat.id);
    for (const event of events) {
      await appendMessageEvent(newUserId, chat.id, event);
    }
    await db.orm.public.Chat.where({ id: chat.id }).update({ userId: newUserId });
  }

  // Stored images follow their owner, so /api/content keeps serving them
  // after the guest becomes an account.
  await db.orm.public.Content.where({ userId: anonymousUserId }).update({
    userId: newUserId,
  });
}

// The app's public URL is a platform-resolved property of the service
// (ADR-0039), not operator config.
const appOrigin = service.origin();

export const auth = betterAuth({
  baseURL: appOrigin,
  secret: service.secrets().betterAuthSecret.expose(),
  database: pool,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
  plugins: [
    anonymous({
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        await migrateGuestData(anonymousUser.user.id, newUser.user.id);
      },
    }),
  ],
  trustedOrigins: [appOrigin],
});

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export async function getSession(request: Request) {
  return auth.api.getSession({
    headers: request.headers,
  });
}
