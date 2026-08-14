import { Router } from "express";
import { validate } from "../middleware/validate";
import { requireAuth } from "../middleware/require-auth";
import {
  getFoodById,
  isFatSecretConfigured,
  searchFoods,
} from "../services/fatsecret";
import { foodSearchQuerySchema } from "../types/food";
import { sendNotImplemented } from "../utils/not-implemented";
import { AppError } from "../types/api";

export const foodRouter = Router();

foodRouter.get(
  "/search",
  requireAuth,
  validate(foodSearchQuerySchema, "query"),
  async (req, res, next) => {
    try {
      if (!isFatSecretConfigured()) {
        sendNotImplemented(
          res,
          "Food search requires FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET.",
        );
        return;
      }

      const q = String(req.query.q ?? "");
      const page = Number(req.query.page ?? 0);
      const maxResults = Number(req.query.maxResults ?? 20);

      const result = await searchFoods({ q, page, maxResults });
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  },
);

foodRouter.get("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!isFatSecretConfigured()) {
      sendNotImplemented(
        res,
        "Food detail requires FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET.",
      );
      return;
    }

    const rawId = req.params.id;
    const id = typeof rawId === "string" ? rawId.trim() : "";
    if (!id) {
      throw new AppError(400, "VALIDATION_ERROR", "Food id is required");
    }

    const food = await getFoodById(id);
    res.json({ ok: true, food });
  } catch (err) {
    next(err);
  }
});
