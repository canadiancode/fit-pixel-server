import { z } from "zod";

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "sexual",
  "violence",
  "other",
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];

export const SAFETY_LIMITS = {
  reportDetailsMax: 500,
} as const;

export const blockBodySchema = z.object({
  userId: z.string().uuid(),
});

export const blockedUserIdParamSchema = z.object({
  userId: z.string().uuid(),
});

export const createReportBodySchema = z.object({
  reportedUserId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(SAFETY_LIMITS.reportDetailsMax).optional(),
});

export type CreateReportBody = z.infer<typeof createReportBodySchema>;

export type BlockedUserItem = {
  userId: string;
  displayName: string;
  blockedAt: string;
};
