/**
 * Canonical resource URL for x402 (O4). One normalisation function for every origin and URL the x402 path compares:
 * lowercase scheme and host, default ports stripped, IDN hosts in punycode (WHATWG URL), no userinfo, query or fragment
 * in an origin, no wildcards, no lists. The trusted origin is never derived from Host or X-Forwarded-* headers.
 *
 * Only used when x402 is enabled; a turnspike/1-only middleware never calls anything in this file.
 */
import type { Request } from "express";

export interface ResourceUrlOptions {
  /**
   * Server-trusted public origin, e.g. "https://api.example.com". The canonical resource URL is
   * `publicOrigin + basePath + path and query of req.originalUrl`.
   */
  publicOrigin?: string;
  /**
   * Same as publicOrigin when a string. As a function: a resolver (req) => absolute canonical URL. It receives a view of
   * the request in which Host, X-Forwarded-*, Forwarded, req.protocol, req.hostname, req.secure and req.ip throw; its result
   * is normalised and must end with the validated path and query of the request.
   */
  resourceUrl?: string | ((req: Request) => string);
  /** Public path prefix stripped by a reverse proxy, e.g. "/api" (public /api/v1/report reaches the app as /v1/report). */
  basePath?: string;
  /** Production mode. Default: process.env.NODE_ENV === "production". In production a trusted origin is required. */
  production?: boolean;
}

export type ResourceUrlMode = "origin" | "resolver" | "dev";

export type CanonicalResult =
  | { ok: true; url: string; trusted: boolean; pathAndQuery: string }
  | { ok: false; status: 400 | 500; reason: "non_canonical_url" | "resource_url_resolver_failed" };

export interface ResourceUrlPolicy {
  readonly mode: ResourceUrlMode;
  readonly production: boolean;
  /** The configured origin (mode "origin") or null. */
  readonly origin: string | null;
  readonly basePath: string;
  /** Canonical URL of this request. `trusted` is false only in the non-production dev fallback. */
  canonical(req: Request): CanonicalResult;
  /**
   * True when `presented` names the canonical URL of this request. Trusted mode: exact match after normalisation (origin,
   * path and query). Dev fallback: path and query only (the origin is not known).
   */
  matches(presented: string, canonical: CanonicalResult & { ok: true }): boolean;
}

export class ResourceUrlConfigError extends Error {
  constructor(message: string) { super(`x402 resource URL: ${message}`); this.name = "ResourceUrlConfigError"; }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLocalHost = (h: string) => LOCAL_HOSTS.has(h) || h.endsWith(".localhost");

/**
 * Normalises a configured public origin. Throws ResourceUrlConfigError on anything missing, malformed, ambiguous or unsafe.
 * Accepts "https://api.example.com" and one trailing "/". Returns the ASCII origin ("https://api.example.com").
 */
export function normalizeOrigin(raw: unknown, opts: { production?: boolean } = {}): string {
  if (typeof raw !== "string") throw new ResourceUrlConfigError("the public origin must be a string");
  const s = raw;
  if (!s) throw new ResourceUrlConfigError("the public origin is empty");
  if (/[\s,]/.test(s)) throw new ResourceUrlConfigError("the public origin contains whitespace or a comma (multiple origins are not allowed)");
  if (s.includes("*")) throw new ResourceUrlConfigError("wildcards are not allowed in the public origin");
  if (s.includes("\\")) throw new ResourceUrlConfigError("backslashes are not allowed in the public origin");
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(s);
  if (!m) throw new ResourceUrlConfigError("the public origin must be an absolute URL such as https://api.example.com");
  const [, scheme, authority, rest] = m;
  const sch = scheme.toLowerCase();
  if (sch !== "https" && sch !== "http") throw new ResourceUrlConfigError("the public origin must use https (or http on localhost)");
  if (!authority) throw new ResourceUrlConfigError("the public origin has an empty host");
  if (authority.includes("@")) throw new ResourceUrlConfigError("userinfo is not allowed in the public origin");
  if (rest.includes("?")) throw new ResourceUrlConfigError("a query is not allowed in the public origin");
  if (rest.includes("#")) throw new ResourceUrlConfigError("a fragment is not allowed in the public origin");
  if (rest !== "" && rest !== "/") throw new ResourceUrlConfigError("a path is not allowed in the public origin (ambiguous); use basePath for a prefix");
  let u: URL;
  try { u = new URL(s); } catch { throw new ResourceUrlConfigError("the public origin is not a valid URL"); }
  if (!u.hostname) throw new ResourceUrlConfigError("the public origin has an empty host");
  if (u.hostname.endsWith(".")) throw new ResourceUrlConfigError("a trailing dot in the host is ambiguous");
  if (u.username || u.password) throw new ResourceUrlConfigError("userinfo is not allowed in the public origin");
  const prod = opts.production ?? false;
  if (prod && u.protocol === "http:" && !isLocalHost(u.hostname)) throw new ResourceUrlConfigError("http is allowed only on localhost in production; use https");
  return u.origin;
}

/** Normalises a base path: "" (none) or "/seg[/seg...]" without a trailing slash, query, fragment, dot segments or wildcards. */
export function normalizeBasePath(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") throw new ResourceUrlConfigError("basePath must be a string");
  if (!raw.startsWith("/") || raw.startsWith("//")) throw new ResourceUrlConfigError("basePath must start with a single '/'");
  if (raw === "/") return "";
  if (raw.endsWith("/")) throw new ResourceUrlConfigError("basePath must not end with '/' (trailing-path ambiguity)");
  if (/[\s?#*\\,]/.test(raw)) throw new ResourceUrlConfigError("basePath must not contain whitespace, '?', '#', '*', ',' or '\\'");
  if (/%(?![0-9A-Fa-f]{2})|%2[eEfF]|%5[cC]/.test(raw)) throw new ResourceUrlConfigError("basePath has a malformed or ambiguous percent-escape");
  if (raw.split("/").some((seg, i) => i > 0 && (seg === "" || seg === "." || seg === ".."))) throw new ResourceUrlConfigError("basePath must not contain empty or dot segments");
  if (new URL(raw, "http://x").pathname !== raw) throw new ResourceUrlConfigError("basePath is not in normalised percent-encoded form");
  return raw;
}

/**
 * Validated path and query of a request target (req.originalUrl). Returns null for anything that is not a plain
 * origin-form target, or whose normalised form differs from what was received (dot segments, backslashes, "//" prefix,
 * fragments, unencoded characters), so the canonical URL always names exactly what the app routed.
 */
export function pathAndQuery(originalUrl: unknown): string | null {
  if (typeof originalUrl !== "string" || !originalUrl.startsWith("/") || originalUrl.startsWith("//")) return null;
  if (originalUrl.length > 8192 || /[\s#\\]/.test(originalUrl)) return null;
  // malformed escapes, and encoded "." "/" "\" in the path, are ambiguous between proxies and the app
  if (/%(?![0-9A-Fa-f]{2})/.test(originalUrl) || /%2[eEfF]|%5[cC]/.test(originalUrl.split("?")[0])) return null;
  let u: URL;
  try { u = new URL(originalUrl, "http://canonical.invalid"); } catch { return null; }
  if (u.origin !== "http://canonical.invalid") return null;
  const q = originalUrl.indexOf("?");
  const rawPath = q >= 0 ? originalUrl.slice(0, q) : originalUrl;
  const rawQuery = q >= 0 ? originalUrl.slice(q) : "";
  if (u.pathname !== rawPath) return null; // dot segments or non-normalised encoding
  if (rawQuery !== "?" && u.search !== rawQuery) return null; // non-normalised query encoding
  return u.pathname + u.search;
}

/**
 * Normalises an absolute resource URL for comparison: lowercase scheme and host, default port stripped, punycode host,
 * normalised path, query kept as is ("?" alone dropped). Null for anything that is not a plain http(s) URL, or that has
 * userinfo, a fragment, an empty host or a wildcard.
 */
export function normalizeResourceUrl(raw: unknown, opts: { production?: boolean } = {}): { origin: string; pathAndQuery: string; url: string } | null {
  if (typeof raw !== "string" || raw.length > 8192 || /[\s\\*]/.test(raw) || raw.includes("#")) return null;
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(raw);
  if (!m || !m[2] || m[2].includes("@")) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname || u.hostname.endsWith(".") || u.username || u.password) return null;
  if (opts.production && u.protocol === "http:" && !isLocalHost(u.hostname)) return null;
  const rest = m[3] === "" ? "/" : m[3];
  const pq = pathAndQuery(rest);
  if (pq === null) return null;
  return { origin: u.origin, pathAndQuery: pq, url: u.origin + pq };
}

const BANNED_HEADER = /^(host|forwarded|x-forwarded-.*|x-real-ip|x-original-host|x-host)$/i;
const BANNED_PROPS = new Set(["hostname", "host", "protocol", "secure", "subdomains", "ip", "ips", "rawHeaders", "headersDistinct", "rawHeadersDistinct"]);

/**
 * A view of the request that throws on every client-controlled source of origin information (Host, X-Forwarded-*,
 * Forwarded, and the Express getters derived from them). Given to a resourceUrl resolver so it cannot derive the origin
 * from headers, even by accident.
 */
export function headerlessView(req: Request): Request {
  const deny = (what: string): never => { throw new ResourceUrlConfigError(`the resourceUrl resolver must not read ${what} (client-controlled)`); };
  const headers = new Proxy(req.headers ?? {}, {
    get(t, k) { if (typeof k === "string" && BANNED_HEADER.test(k)) deny(`the ${k} header`); return Reflect.get(t, k); },
    has(t, k) { if (typeof k === "string" && BANNED_HEADER.test(k)) deny(`the ${k} header`); return Reflect.has(t, k); },
    ownKeys(t) { return Reflect.ownKeys(t).filter((k) => !(typeof k === "string" && BANNED_HEADER.test(k))); },
  });
  const getHeader = (name: string) => { if (BANNED_HEADER.test(String(name))) deny(`the ${name} header`); return req.get(name as any); };
  return new Proxy(req, {
    get(t, p) {
      if (typeof p === "string" && BANNED_PROPS.has(p)) deny(`req.${p}`);
      if (p === "headers") return headers;
      if (p === "get" || p === "header") return getHeader;
      const v = Reflect.get(t, p, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as Request;
}

let devWarned = false;
/** Test hook: lets a test observe the one-time warning again. */
export function resetDevWarning() { devWarned = false; }

/**
 * Builds the resource URL policy. Throws ResourceUrlConfigError at construction (before any request is served) when the
 * configuration is missing in production, malformed, ambiguous or unsafe. In non-production without a configured origin
 * it falls back to the dev mode with a loud one-time warning: resource.url is advertised from what the server sees and
 * is compared by path and query only (never trusted, whatever `trust proxy` says).
 */
export function createResourceUrlPolicy(o: ResourceUrlOptions = {}, warn: (msg: string) => void = (m) => console.warn(m)): ResourceUrlPolicy {
  const production = o.production ?? process.env.NODE_ENV === "production";
  if (o.publicOrigin !== undefined && o.resourceUrl !== undefined) throw new ResourceUrlConfigError("set either publicOrigin or resourceUrl, not both (ambiguous)");
  const basePath = normalizeBasePath(o.basePath);
  const originRaw = o.publicOrigin ?? (typeof o.resourceUrl === "string" ? o.resourceUrl : undefined);
  const resolver = typeof o.resourceUrl === "function" ? o.resourceUrl : undefined;
  if (o.resourceUrl !== undefined && typeof o.resourceUrl !== "string" && typeof o.resourceUrl !== "function") throw new ResourceUrlConfigError("resourceUrl must be an origin string or a function");
  if (resolver && basePath) throw new ResourceUrlConfigError("basePath applies to publicOrigin only; a resolver returns the full URL");

  if (originRaw !== undefined) {
    const origin = normalizeOrigin(originRaw, { production });
    return {
      mode: "origin", production, origin, basePath,
      canonical(req) {
        const pq = pathAndQuery(req.originalUrl);
        if (pq === null) return { ok: false, status: 400, reason: "non_canonical_url" };
        return { ok: true, url: origin + basePath + pq, trusted: true, pathAndQuery: basePath + pq };
      },
      matches: (presented, c) => normalizeResourceUrl(presented)?.url === c.url,
    };
  }
  if (resolver) {
    return {
      mode: "resolver", production, origin: null, basePath: "",
      canonical(req) {
        const pq = pathAndQuery(req.originalUrl);
        if (pq === null) return { ok: false, status: 400, reason: "non_canonical_url" };
        let out: unknown;
        try { out = resolver(headerlessView(req)); } catch { return { ok: false, status: 500, reason: "resource_url_resolver_failed" }; }
        const n = normalizeResourceUrl(out, { production });
        // the resolver chooses the origin and may add a prefix; the path and query must be the request's own
        const tail = pq.split("?");
        const nTail = n?.pathAndQuery.split("?");
        if (!n || !nTail || !nTail[0].endsWith(tail[0]) || (nTail[1] ?? "") !== (tail[1] ?? "")) return { ok: false, status: 500, reason: "resource_url_resolver_failed" };
        return { ok: true, url: n.url, trusted: true, pathAndQuery: n.pathAndQuery };
      },
      matches: (presented, c) => normalizeResourceUrl(presented)?.url === c.url,
    };
  }
  if (production) {
    throw new ResourceUrlConfigError(
      "x402 is enabled in production without a trusted public origin. Set x402.publicOrigin (e.g. \"https://api.example.com\", " +
      "plus x402.basePath behind a prefix-stripping proxy) or x402.resourceUrl as a resolver that does not read Host or X-Forwarded-*.",
    );
  }
  if (!devWarned) {
    devWarned = true;
    warn(
      "WARNING [turnspike x402]: no public origin configured (x402.publicOrigin / x402.resourceUrl). DEVELOPMENT FALLBACK: " +
      "resource.url is advertised from the origin this server sees and compared by path and query only; the origin is never trusted. " +
      "This configuration is refused when NODE_ENV=production.",
    );
  }
  return {
    mode: "dev", production, origin: null, basePath,
    canonical(req) {
      const pq = pathAndQuery(req.originalUrl);
      if (pq === null) return { ok: false, status: 400, reason: "non_canonical_url" };
      // advertised only, never trusted: the request's own scheme and Host (development fallback)
      return { ok: true, url: `${req.protocol}://${req.get("host")}${basePath}${pq}`, trusted: false, pathAndQuery: basePath + pq };
    },
    matches: (presented, c) => normalizeResourceUrl(presented)?.pathAndQuery === c.pathAndQuery,
  };
}
