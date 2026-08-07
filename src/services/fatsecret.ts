import { env, isFatSecretConfigured } from "../config/env";
import { AppError } from "../types/api";
import type {
  FoodDetailResponse,
  FoodDetailServing,
  FoodSearchItem,
  FoodSearchResponse,
} from "../types/food";

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
    throw new AppError(
      502,
      "UPSTREAM_ERROR",
      "Failed to obtain FatSecret access token",
      { status: response.status, body: text.slice(0, 500) },
    );
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
    throw new AppError(502, "UPSTREAM_ERROR", "FatSecret API request failed", {
      status: response.status,
      body: text.slice(0, 500),
    });
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

function normalizeSearchItem(raw: Record<string, unknown>): FoodSearchItem {
  const id = String(raw.food_id ?? "");
  const name = String(raw.food_name ?? "");
  const brandName =
    raw.brand_name != null ? String(raw.brand_name) : undefined;
  const description =
    raw.food_description != null ? String(raw.food_description) : undefined;

  let kcal: number | undefined;
  if (description) {
    const match = /Calories:\s*([\d.]+)/i.exec(description);
    if (match) kcal = Number(match[1]);
  }

  return { id, name, brandName, description, kcal };
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
  return {
    id: raw.serving_id != null ? String(raw.serving_id) : undefined,
    description:
      raw.serving_description != null
        ? String(raw.serving_description)
        : undefined,
    calories: parseOptionalNumber(raw.calories),
    carbohydrate: parseOptionalNumber(raw.carbohydrate),
    protein: parseOptionalNumber(raw.protein),
    fat: parseOptionalNumber(raw.fat),
    metricAmount: parseOptionalNumber(raw.metric_serving_amount),
    metricUnit:
      raw.metric_serving_unit != null
        ? String(raw.metric_serving_unit)
        : undefined,
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

  const servings = asArray(food.servings?.serving).map(normalizeServing);

  return {
    id: String(food.food_id),
    name: String(food.food_name ?? ""),
    brandName: food.brand_name != null ? String(food.brand_name) : undefined,
    servings,
  };
}
