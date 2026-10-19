import { z } from "zod";

/** `ExponentPushToken[…]` / `ExpoPushToken[…]` — matches push_tokens_token_ck. */
export const EXPO_PUSH_TOKEN_RE = /^Expo(nent)?PushToken\[[^\]]+\]$/;

const expoPushTokenSchema = z.string().max(255).regex(EXPO_PUSH_TOKEN_RE);

export const registerPushTokenBodySchema = z.object({
  token: expoPushTokenSchema,
  platform: z.enum(["ios", "android"]),
});

export const unregisterPushTokenBodySchema = z.object({
  token: expoPushTokenSchema,
});

export type RegisterPushTokenBody = z.infer<typeof registerPushTokenBodySchema>;
