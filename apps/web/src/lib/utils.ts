import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatUnits, isAddress, parseUnits } from "ethers";

export const cn = (...i: ClassValue[]) => twMerge(clsx(i));

export const short = (a: string, l = 6, r = 4) => (a.length > l + r + 2 ? `${a.slice(0, l)}…${a.slice(-r)}` : a);

/** Base units to a QUSDC string. QUSDC has 6 decimals: 1 QUSDC = 1,000,000 base units. */
export const fmtUsdc = (v: bigint | string, max = 6) => {
  const s = formatUnits(v, 6);
  const [i, f = ""] = s.split(".");
  const frac = f.slice(0, max).replace(/0+$/, "");
  return `${Number(i).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
};

export const parseUsdc = (s: string): bigint | null => {
  const t = s.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  return parseUnits(t, 6);
};

/**
 * What the owner sees must be exactly what the contract receives. ethers also accepts ICAP and un-prefixed forms and
 * silently converts them, so the console requires the plain 0x form (with a valid checksum when mixed case).
 */
export const isHexAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a) && isAddress(a);

export const ZERO = "0x0000000000000000000000000000000000000000";
