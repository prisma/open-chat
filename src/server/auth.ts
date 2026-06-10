import { betterAuth } from "better-auth";
import { pool } from "../prisma/db";
import { env } from "./env";

export const auth = betterAuth({
  baseURL: env.APP_ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  database: pool,
  emailAndPassword: {
    enabled: true,
  },
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
