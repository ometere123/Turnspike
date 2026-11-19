import { z } from "zod";

/** Protocol version this client speaks. Challenges that state a different version are refused. */
export const PROTOCOL = "turnspike/1";

const addr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

/** The JSON body of a Turnspike HTTP 402 response. `protocol` and `paymentDeadline` are absent on older gateways. */
export const challengeSchema = z.object({
  error: z.literal("payment_required"),
  protocol: z.string().optional(),
  requestId: hex32,
  sig: z.string().regex(/^[0-9a-fA-F]{64}$/),
  priceBase: z.string().regex(/^[0-9]+$/),
  token: addr,
  contract: addr,
  merchant: addr,
  chainId: z.number().int().positive(),
  resourceId: z.string().min(1).max(2048),
  expiresAt: z.number().int().positive(),
  paymentDeadline: z.number().int().positive().optional(),
});
export type Challenge = z.infer<typeof challengeSchema>;

export interface Proof { requestId: string; txHash: string; sig: string }

/** The X-Payment header value: base64 of the JSON proof. All three fields are required. */
export const encodeProof = (p: Proof) => Buffer.from(JSON.stringify({ requestId: p.requestId, txHash: p.txHash, sig: p.sig })).toString("base64");

export interface Network {
  name: string;
  chainId: number;
  /** Deployed TurnpikeAllowance settlement contract (on-chain name kept from the original deployment). */
  contract: string;
  /** QUSDC token. */
  token: string;
  decimals: number;
  rpcUrls: string[];
  explorer: string;
}

/** QIE Mainnet with the deployed settlement contract and QUSDC. */
export const QIE_MAINNET: Network = {
  name: "QIE Mainnet",
  chainId: 1990,
  contract: "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c",
  token: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  decimals: 6,
  rpcUrls: ["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital"],
  explorer: "https://mainnet.qie.digital",
};

export const ALLOWANCE_ABI = [
  "function pay(address owner, address merchant, bytes32 requestId, uint256 amount)",
  "function account(address owner) view returns (tuple(uint256 balance, bool paused, address agent, uint256 perCallCap, uint256 dailyCap, uint256 dayIndex, uint256 spentToday))",
  "function allowedMerchant(address owner, address merchant) view returns (bool)",
  "function isUsed(address merchant, bytes32 requestId) view returns (bool)",
  "function spentToday(address owner) view returns (uint256)",
  "function token() view returns (address)",
  "event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)",
  "error NotOwnerAgent()", "error Paused()", "error MerchantNotAllowed()", "error CapExceeded(uint256 cap, uint256 attempted)",
  "error DailyCapExceeded(uint256 cap, uint256 attempted)", "error RequestAlreadyUsed(bytes32 requestId)", "error InsufficientBalance()",
  "error DepositCapExceeded()", "error ZeroAmount()", "error ZeroAddress()",
] as const;

/** Formats base units with the token's decimals, e.g. 1000 -> "0.001". */
export function formatUnits(base: bigint | string, decimals = 6): string {
  const v = BigInt(base);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return (neg ? "-" : "") + whole + (frac ? "." + frac : "");
}

/** Parses a decimal amount ("0.001") into base units. Throws on more precision than the token supports. */
export function parseUnits(amount: string, decimals = 6): bigint {
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amount.trim())) throw new Error(`not a decimal amount: ${amount}`);
  const [w, f = ""] = amount.trim().split(".");
  if (f.length > decimals) throw new Error(`more than ${decimals} decimal places: ${amount}`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, "0") || "0");
}
