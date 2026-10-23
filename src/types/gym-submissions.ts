import { z } from "zod";

export const GYM_SUBMISSION_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  addressMax: 200,
  notesMax: 500,
  /** Waiting for review at once. Keep in step with the insert policy in 20261028000000_gym_submissions.sql. */
  pendingMax: 10,
  /** Rows returned by GET /v1/gym-submissions/mine. */
  listMax: 50,
} as const;

/** The map's gym types (fit-pixel-app features/map/gym-filters.ts GymKind). */
export const GYM_KINDS = [
  "fitness-world",
  "anytime",
  "planet",
  "club16",
  "goodlife",
  "evolve",
  "golds",
  "fit4less",
  "community",
  "independent",
] as const;

export type GymKind = (typeof GYM_KINDS)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const createGymSubmissionBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(GYM_SUBMISSION_LIMITS.nameMin)
    .max(GYM_SUBMISSION_LIMITS.nameMax),
  address: optionalText(GYM_SUBMISSION_LIMITS.addressMax),
  kind: z.enum(GYM_KINDS).optional(),
  notes: optionalText(GYM_SUBMISSION_LIMITS.notesMax),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

export type CreateGymSubmissionBody = z.infer<typeof createGymSubmissionBodySchema>;

export type GymSubmissionStatus = "pending" | "approved" | "rejected";

export type GymSubmissionItem = {
  id: string;
  name: string;
  address: string | null;
  kind: GymKind | null;
  notes: string | null;
  latitude: number;
  longitude: number;
  status: GymSubmissionStatus;
  /** Why it was rejected, or a note on approval. */
  reviewerNotes: string | null;
  /** The live gym, once approved. */
  gymId: string | null;
  createdAt: string;
  reviewedAt: string | null;
};
