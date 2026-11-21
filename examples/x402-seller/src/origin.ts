import { normalizeOrigin } from "@turnspike-qie/middleware/origin";

/**
 * Validates and normalises PUBLIC_ORIGIN with the library's single normalisation function (O4): an absolute https origin
 * (http on localhost only in production) with no path, query, fragment, userinfo, wildcard or list, for example
 * "https://api.example.com". Returns undefined for an unset or empty value; throws on anything else that is not valid.
 */
export function normalizePublicOrigin(raw: string | undefined, production = process.env.NODE_ENV === "production"): string | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  return normalizeOrigin(raw.trim(), { production });
}
