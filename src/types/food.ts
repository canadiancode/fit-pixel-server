import { z } from "zod";

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(0).optional().default(0),
  maxResults: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;

/**
 * Fields aligned with Expo `FoodHabitPayload` / custom-meal form so search
 * results can feed `addFood()` and appear in recent meals the same way.
 *
 * List UI (`FoodMealListItem`) mapping:
 *   kcal → calories, proteinG → protein, carbsG → carbs, fatG → fat,
 *   brandName → vendor
 */
export type FoodSearchItem = {
  id: string;
  name: string;
  brandName?: string;
  description?: string;
  /** Habit-compatible macros (from FatSecret description when available) */
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  portionSize?: string;
  /** List-row aliases for Expo `FoodMealListItem` */
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

export type FoodSearchResponse = {
  foods: FoodSearchItem[];
  page: number;
  maxResults: number;
  totalResults?: number;
};

export type FoodDetailServing = {
  id?: string;
  description?: string;
  /** Raw FatSecret field names */
  calories?: number;
  carbohydrate?: number;
  protein?: number;
  fat?: number;
  metricAmount?: number;
  metricUnit?: string;
  isDefault?: boolean;
  /** Habit-compatible aliases (`FoodHabitPayload`) */
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  portionSize?: string;
};

/**
 * Ready for Expo `addFood()` / `saveMeal()` without further renaming
 * (same fields as custom meal).
 */
export type FoodHabitReadyPayload = {
  name: string;
  kcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  portionSize?: string;
  /** Maps to SavedMeal.vendor when hearting / saving */
  vendor?: string;
};

export type FoodDetailResponse = {
  id: string;
  name: string;
  brandName?: string;
  servings: FoodDetailServing[];
  /**
   * Default (or first usable) serving mapped for `addFood` / recent foods.
   * Prefer this when the client does not need a serving picker.
   */
  habitPayload?: FoodHabitReadyPayload;
};
