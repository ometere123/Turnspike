import { getAddress, isAddress } from "ethers";

const API = "https://sdk-live.qie.digital/api/v1/domains/public";
const QIE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.qie$/;
// Browser-only cache. The lookup is opt-in and does not participate in authorization.
const cache = new Map<string, { expires: number; result: QieNameResult }>();

type RecordValue = Record<string, unknown>;
type QieNameResult =
  | { ok: true; address: string; name: string }
  | { ok: false; message: string };

const object = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;

async function request(path: string): Promise<RecordValue> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(API + path, { signal: controller.signal, method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    if (response.status === 429) throw new Error("QIE ID has reached its public request limit. Try again later.");
    if (response.status === 404) throw new Error("No public QIE ID record was found.");
    if (!response.ok) throw new Error("QIE ID is temporarily unavailable.");
    const payload = object(await response.json());
    if (!payload || payload.status !== "SUCCESS") throw new Error("QIE ID returned an unrecognized result.");
    return payload;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("QIE ID could not be reached. The address remains usable.");
    if (error instanceof Error && error.name === "AbortError") throw new Error("QIE ID timed out. The address remains usable.");
    throw error;
  } finally { clearTimeout(timer); }
}

function namesFromReverse(data: RecordValue): string[] {
  if (!Array.isArray(data.domains)) return [];
  return data.domains.map((entry: unknown) => {
    if (typeof entry === "string") return entry.toLowerCase();
    const item = object(entry);
    const name = item?.domainName ?? item?.name ?? item?.domain;
    return typeof name === "string" ? name.toLowerCase() : "";
  }).filter((name: string) => QIE_NAME.test(name));
}

/**
 * Returns only an unambiguous forward/reverse matching display label.
 * This is not KYC, ownership authentication, wallet authorization, or a transaction destination.
 */
export async function lookupQieName(address: string): Promise<QieNameResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !isAddress(address)) return { ok: false, message: "Enter a valid wallet address first." };
  const key = getAddress(address).toLowerCase();
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.result;
  try {
    const reverse = await request("/resolution/" + encodeURIComponent(getAddress(address)));
    const data = object(reverse.data);
    if (!data || !isAddress(data.address) || getAddress(data.address).toLowerCase() !== key) {
      throw new Error("The QIE ID reverse record does not match this address.");
    }
    // Count the raw entries, not only the well-formed ones: a second unreadable or unlisted name is still ambiguity.
    const listed = Array.isArray(data.domains) ? data.domains.length : 0;
    const total = typeof data.totalDomains === "number" ? data.totalDomains : listed;
    if (Math.max(listed, total) > 1) throw new Error("Multiple QIE ID names were found; no canonical name is assumed.");
    const names = [...new Set(namesFromReverse(data))];
    if (names.length !== 1) throw new Error("No QIE ID name is associated with this address.");
    const name = names[0];
    const forward = await request("/lookup/" + encodeURIComponent(name));
    const record = object(forward.data);
    if (!record || record.domainName?.toString().toLowerCase() !== name || !isAddress(record.owner) || getAddress(record.owner).toLowerCase() !== key) {
      throw new Error("The QIE ID forward and reverse records do not agree.");
    }
    const result: QieNameResult = { ok: true, address: getAddress(address), name };
    cache.set(key, { expires: Date.now() + 60_000, result });
    return result;
  } catch (error) {
    const result: QieNameResult = { ok: false, message: error instanceof Error ? error.message : "QIE ID lookup failed." };
    // Short negative cache avoids hammering the public 30/min/IP API during an outage.
    cache.set(key, { expires: Date.now() + 15_000, result });
    return result;
  }
}
