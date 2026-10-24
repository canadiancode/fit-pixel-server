import { z } from "zod";

export const joinWaitlistBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  platform: z.enum(["ios", "android"]),
  source: z.string().trim().max(200).optional(),
});

export type JoinWaitlistBody = z.infer<typeof joinWaitlistBodySchema>;

/** Browser origins allowed to post to the waitlist. */
export const WAITLIST_ORIGINS = [
  "https://fitpixel.app",
  "https://www.fitpixel.app",
  "http://localhost:4321",
  "http://127.0.0.1:4321",
];
