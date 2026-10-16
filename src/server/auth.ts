import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { getDb } from "./db.ts";
import { liveConfig } from "./env.ts";
import { AppError } from "../core/errors.ts";

function createAuth() {
  const config = liveConfig();
  const passwordLogin = config.AUTH_METHOD === "email-password";
  return betterAuth({
    baseURL: config.APP_BASE_URL,
    secret: config.BETTER_AUTH_SECRET!,
    trustedOrigins: [new URL(config.APP_BASE_URL).origin],
    database: prismaAdapter(getDb(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: passwordLogin,
      disableSignUp: config.EMAIL_SIGNUP_ENABLED !== "true",
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      autoSignIn: true,
    },
    socialProviders: passwordLogin ? {} : { google: { clientId: config.GOOGLE_CLIENT_ID!, clientSecret: config.GOOGLE_CLIENT_SECRET!, prompt: "select_account" } },
    rateLimit: {
      enabled: true,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },
    databaseHooks: { user: { create: { before: async (user, context) => {
      const allowedMethod = passwordLogin ? context?.path === "/sign-up/email" : user.emailVerified;
      if (!allowedMethod || user.email.toLowerCase() !== config.OWNER_EMAIL!.trim().toLowerCase()) throw new APIError("FORBIDDEN", { code: "OWNER_ONLY", message: "This dashboard is restricted to its owner." });
    } } } },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;
export function getAuth() { return auth ??= createAuth(); }

export async function requireOwner(headers: Headers) {
  const config = liveConfig();
  const session = await getAuth().api.getSession({ headers });
  if (!session) throw new AppError("SIGN_IN_REQUIRED", 401);
  if (session.user.email.toLowerCase() !== config.OWNER_EMAIL!.trim().toLowerCase()) throw new AppError("OWNER_ONLY", 403);
  if (config.AUTH_METHOD === "email-password") {
    const account = await getDb().account.findFirst({ where: { userId: session.user.id, providerId: "credential", password: { not: null } } });
    if (!account?.password) throw new AppError("OWNER_ONLY", 403);
  } else if (!session.user.emailVerified) throw new AppError("OWNER_ONLY", 403);
  if (config.AUTH_METHOD === "google" && config.OWNER_GOOGLE_SUB) {
    const account = await getDb().account.findFirst({ where: { userId: session.user.id, providerId: "google", accountId: config.OWNER_GOOGLE_SUB } });
    if (!account) throw new AppError("OWNER_ONLY", 403);
  }
  return { ownerId: session.user.id, sessionId: session.session.id, name: session.user.name };
}
