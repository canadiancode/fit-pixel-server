import { env, isFatSecretConfigured } from "../config/env";
import { AppError } from "../types/api";
import type {
  FoodDetailResponse,
  FoodDetailServing,
  FoodHabitReadyPayload,
  FoodSearchItem,
  FoodSearchResponse,
} from "../types/food";
import { parseFatSecretDescription } from "../utils/parse-fatsecret-description";

const TOKEN_URL = "https://oauth.fatsecret.com/connect/token";
const API_BASE = "https://platform.fatsecret.com/rest";

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

export { isFatSecretConfigured };

async function fetchAccessToken(): Promise<string> {
  const clientId = env.FATSECRET_CLIENT_ID;
  const clientSecret = env.FATSECRET_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError(
      501,
      "NOT_IMPLEMENTED",
      "FatSecret is not configured. Set FATSECRET_CLIENT_ID and FATSECRET_CLIENT_SECRET.",
    );
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return tokenCache.accessToken;
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "basic",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("FatSecret token request failed", {
      status: response.status,
      body: text.slice(0, 500),
    });
    throw new AppError(502, "UPSTREAM_ERROR", "FatSecret API request failed");
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!data.access_token) {
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "FatSecret token response missing access_token",
    );
  }

  const expiresInSec = data.expires_in ?? 3600;
  tokenCache = {
    accessToken: data.access_token,
    expiresAtMs: now + expiresInSec * 1000,
  };

  return data.access_token;
}

async function fatSecretGet(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const token = await fetchAccessToken();
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("FatSecret API request failed", {
      status: response.status,
      body: text.slice(0, 500),
    });
    throw new AppError(502, "UPSTREAM_ERROR", "FatSecret API request failed");
  }

  return response.json();
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  const s = String(value).toLowerCase();
  if (s === "1" || s === "true") return true;
  if (s === "0" || s === "false") return false;
  return undefined;
}

function normalizeSearchItem(raw: Record<string, unknown>): FoodSearchItem {
  const id = String(raw.food_id ?? "");
  const name = String(raw.food_name ?? "");
  const brandName =
    raw.brand_name != null ? String(raw.brand_name) : undefined;
  const description =
    raw.food_description != null ? String(raw.food_description) : undefined;

  const parsed = parseFatSecretDescription(description);

  return {
    id,
    name,
    ...(brandName ? { brandName } : {}),
    ...(description ? { description } : {}),
    ...(parsed.kcal !== undefined
      ? { kcal: parsed.kcal, calories: parsed.kcal }
      : {}),
    ...(parsed.proteinG !== undefined
      ? { proteinG: parsed.proteinG, protein: parsed.proteinG }
      : {}),
    ...(parsed.carbsG !== undefined
      ? { carbsG: parsed.carbsG, carbs: parsed.carbsG }
      : {}),
    ...(parsed.fatG !== undefined
      ? { fatG: parsed.fatG, fat: parsed.fatG }
      : {}),
    ...(parsed.portionSize ? { portionSize: parsed.portionSize } : {}),
  };
}

export async function searchFoods(options: {
  q: string;
  page: number;
  maxResults: number;
}): Promise<FoodSearchResponse> {
  const data = (await fatSecretGet("/foods/search/v3", {
    search_expression: options.q,
    page_number: String(options.page),
    max_results: String(options.maxResults),
  })) as {
    foods_search?: {
      total_results?: string | number;
      results?: { food?: Record<string, unknown> | Record<string, unknown>[] };
      food?: Record<string, unknown> | Record<string, unknown>[];
    };
  };

  const search = data.foods_search ?? {};
  const foodsRaw = asArray(
    search.results?.food ?? search.food,
  ) as Record<string, unknown>[];

  const foods = foodsRaw
    .map(normalizeSearchItem)
    .filter((item) => item.id && item.name);

  const totalResults = parseOptionalNumber(search.total_results);

  return {
    foods,
    page: options.page,
    maxResults: options.maxResults,
    ...(totalResults !== undefined ? { totalResults } : {}),
  };
}

function normalizeServing(raw: Record<string, unknown>): FoodDetailServing {
  const calories = parseOptionalNumber(raw.calories);
  const carbohydrate = parseOptionalNumber(raw.carbohydrate);
  const protein = parseOptionalNumber(raw.protein);
  const fat = parseOptionalNumber(raw.fat);
  const description =
    raw.serving_description != null
      ? String(raw.serving_description)
      : undefined;
  const isDefault = parseOptionalBool(raw.is_default);

  return {
    id: raw.serving_id != null ? String(raw.serving_id) : undefined,
    ...(description ? { description, portionSize: description } : {}),
    ...(calories !== undefined ? { calories, kcal: calories } : {}),
    ...(carbohydrate !== undefined
      ? { carbohydrate, carbsG: carbohydrate }
      : {}),
    ...(protein !== undefined ? { protein, proteinG: protein } : {}),
    ...(fat !== undefined ? { fat, fatG: fat } : {}),
    metricAmount: parseOptionalNumber(raw.metric_serving_amount),
    metricUnit:
      raw.metric_serving_unit != null
        ? String(raw.metric_serving_unit)
        : undefined,
    ...(isDefault !== undefined ? { isDefault } : {}),
  };
}

function pickDefaultServing(
  servings: FoodDetailServing[],
): FoodDetailServing | undefined {
  if (servings.length === 0) return undefined;
  const marked = servings.find((s) => s.isDefault && s.kcal != null);
  if (marked) return marked;
  const withKcal = servings.find((s) => s.kcal != null);
  return withKcal ?? servings[0];
}

function toHabitPayload(
  name: string,
  brandName: string | undefined,
  serving: FoodDetailServing,
): FoodHabitReadyPayload | undefined {
  if (serving.kcal == null) return undefined;

  return {
    name,
    kcal: serving.kcal,
    ...(serving.proteinG !== undefined ? { proteinG: serving.proteinG } : {}),
    ...(serving.carbsG !== undefined ? { carbsG: serving.carbsG } : {}),
    ...(serving.fatG !== undefined ? { fatG: serving.fatG } : {}),
    ...(serving.portionSize || serving.description
      ? { portionSize: serving.portionSize ?? serving.description }
      : {}),
    ...(brandName ? { vendor: brandName } : {}),
  };
}

export async function getFoodById(foodId: string): Promise<FoodDetailResponse> {
  const data = (await fatSecretGet("/food/v4", {
    food_id: foodId,
  })) as {
    food?: {
      food_id?: string | number;
      food_name?: string;
      brand_name?: string;
      servings?: {
        serving?: Record<string, unknown> | Record<string, unknown>[];
      };
    };
  };

  const food = data.food;
  if (!food?.food_id) {
    throw new AppError(404, "BAD_REQUEST", `Food not found: ${foodId}`);
  }

  const name = String(food.food_name ?? "");
  const brandName =
    food.brand_name != null ? String(food.brand_name) : undefined;
  const servings = asArray(food.servings?.serving).map(normalizeServing);
  const defaultServing = pickDefaultServing(servings);
  const habitPayload = defaultServing
    ? toHabitPayload(name, brandName, defaultServing)
    : undefined;

  return {
    id: String(food.food_id),
    name,
    ...(brandName ? { brandName } : {}),
    servings,
    ...(habitPayload ? { habitPayload } : {}),
  };
}
