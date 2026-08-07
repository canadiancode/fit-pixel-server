import { z } from "zod";

export const signupBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

export const forgotPasswordBodySchema = z.object({
  email: z.string().email(),
});

export type SignupBody = z.infer<typeof signupBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

/** Planned /v1/me response once auth + Supabase exist. */
export type MeResponse = {
  id: string;
  email: string;
};
