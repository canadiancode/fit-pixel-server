import { Router } from "express";
import { z } from "zod";
import { createUserSupabaseClient } from "../config/supabase";
import { requireAuth } from "../middleware/require-auth";
import { validate } from "../middleware/validate";
import { sanitizeEquipped } from "../services/social";
import { AppError } from "../types/api";

export const leaderboardRouter = Router();

const leaderboardQuerySchema = z.object({
  board: z.enum(["friends", "global"]).default("friends"),
});

type LeaderboardRow = {
  rank: number | string;
  user_id: string;
  display_name: string | null;
  level: number;
  lifetime_xp: number;
  equipped: unknown;
  is_me: boolean;
};

/** Ranked by lifetime XP via public.leaderboard() (blocks excluded). */
leaderboardRouter.get(
  "/",
  requireAuth,
  validate(leaderboardQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const auth = req.auth;
      if (!auth) {
        throw new AppError(401, "UNAUTHORIZED", "Missing auth context");
      }
      const board = leaderboardQuerySchema.parse(req.query).board;
      const { data, error } = await createUserSupabaseClient(auth.token).rpc(
        "leaderboard",
        { board, max_rows: 50 },
      );
      if (error) throw error;
      const entries = ((data ?? []) as LeaderboardRow[]).map((row) => ({
        rank: Number(row.rank),
        userId: row.user_id,
        displayName: row.display_name ?? "",
        level: row.level,
        lifetimeXp: row.lifetime_xp,
        equipped: sanitizeEquipped(row.equipped),
        isMe: row.is_me,
      }));
      res.json({ ok: true, board, entries });
    } catch (err) {
      next(err);
    }
  },
);
