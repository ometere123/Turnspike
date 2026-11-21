/**
 * Validates and normalises the public origin used for x402.resourceUrl. It must be an absolute http(s) origin with no
 * path, query or fragment (for example "https://api.example.com"); anything else would make resource.url invalid and
 * every x402 payment fail the resource check. Returns undefined for an unset or empty value.
 */
export function normalizePublicOrigin(raw: string | undefined): string | undefined {
  const s = raw?.trim().replace(/\/+$/, "");
  if (!s) return undefined;
  let u: URL;
  try { u = new URL(s); } catch { throw new Error(`PUBLIC_ORIGIN must be an absolute URL such as https://api.example.com (got an unparsable value)`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("PUBLIC_ORIGIN must use http or https");
  if (u.origin !== s) throw new Error("PUBLIC_ORIGIN must be an origin only (scheme, host, optional port), with no path, query or credentials");
  return u.origin;
}
