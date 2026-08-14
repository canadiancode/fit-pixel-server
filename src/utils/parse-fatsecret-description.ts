/**
 * FatSecret search rows often include a free-text description like:
 *   "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 11.68g | Protein: 0.26g"
 * Parse that into habit-compatible macros for search list rows.
 */

export type ParsedNutrition = {
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  portionSize?: string;
};

function matchNumber(source: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(source);
  if (!match?.[1]) return undefined;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : undefined;
}

export function parseFatSecretDescription(
  description: string | null | undefined,
): ParsedNutrition {
  if (!description?.trim()) return {};

  const text = description.trim();

  // "Per 100g - ..." or "Per Serving - ..." or "Per 1 cup - ..."
  const portionMatch =
    /^Per\s+([^-|]+?)(?:\s*[-–—]\s*|$)/i.exec(text) ??
    /Per\s+([^|]+?)(?:\s*[-–—]\s*Calories)/i.exec(text);

  const portionSize = portionMatch?.[1]?.trim() || undefined;

  const kcal =
    matchNumber(text, /Calories:\s*([\d.]+)\s*kcal/i) ??
    matchNumber(text, /Calories:\s*([\d.]+)/i);

  const fatG = matchNumber(text, /Fat:\s*([\d.]+)\s*g/i);
  const carbsG =
    matchNumber(text, /Carbs:\s*([\d.]+)\s*g/i) ??
    matchNumber(text, /Carbohydrate:\s*([\d.]+)\s*g/i);
  const proteinG = matchNumber(text, /Protein:\s*([\d.]+)\s*g/i);

  return {
    ...(kcal !== undefined ? { kcal } : {}),
    ...(fatG !== undefined ? { fatG } : {}),
    ...(carbsG !== undefined ? { carbsG } : {}),
    ...(proteinG !== undefined ? { proteinG } : {}),
    ...(portionSize ? { portionSize } : {}),
  };
}
