import { z } from "zod";

export const foodSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(0).optional().default(0),
  maxResults: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export type FoodSearchQuery = z.infer<typeof foodSearchQuerySchema>;

export type FoodSearchItem = {
  id: string;
  name: string;
  brandName?: string;
  description?: string;
  /** Calories when FatSecret provides a default serving summary */
  kcal?: number;
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
  calories?: number;
  carbohydrate?: number;
  protein?: number;
  fat?: number;
  metricAmount?: number;
  metricUnit?: string;
};

export type FoodDetailResponse = {
  id: string;
  name: string;
  brandName?: string;
  servings: FoodDetailServing[];
};
