import { PROFILE_LIMITS } from "../types/limits";

/**
 * Allow empty/null, `@handle`, or `https://` URLs only.
 */
export function parseSocialLink(
  field: string,
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > PROFILE_LIMITS.socialMax) {
    throw new Error(`${field} exceeds max length`);
  }

  if (trimmed.startsWith("@") && !trimmed.includes("://")) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:") {
        throw new Error("not https");
      }
    } catch {
      throw new Error(`${field} must be a valid https URL`);
    }
    return trimmed;
  }

  throw new Error(`${field} must be an @handle or https URL`);
}
