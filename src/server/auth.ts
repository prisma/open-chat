import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { db, pool } from "../prisma/db";
import { env } from "./env";
import { appendMessageEvent, loadAllMessageEvents } from "./streams";

// Social providers light up only when their credentials are configured;
// the client asks /api/config which ones to offer.
const socialProviders = {
  ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
        },
      }
    : {}),
  ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
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
  const chats = await db.orm.Chat.where({ userId: anonymousUserId }).all();

  for (const chat of chats) {
    const { events } = await loadAllMessageEvents(anonymousUserId, chat.id);
    for (const event of events) {
      await appendMessageEvent(newUserId, chat.id, event);
    }
    await db.orm.Chat.where({ id: chat.id }).update({ userId: newUserId });
  }
}

export const auth = betterAuth({
  baseURL: env.APP_ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
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
  trustedOrigins: [env.APP_ORIGIN],
});

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export async function getSession(request: Request) {
  return auth.api.getSession({
    headers: request.headers,
  });
}
