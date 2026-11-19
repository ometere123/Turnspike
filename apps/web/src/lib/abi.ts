/**
 * ABI of contracts/TurnpikeAllowance.sol, matching the deployed contract (human-readable form).
 * Only methods that exist in the contract are listed. Keep in sync with the Solidity source.
 */
export const ALLOWANCE_ABI = [
  "function token() view returns (address)",
  "function depositCap() view returns (uint256)",
  "function allowedMerchant(address owner, address merchant) view returns (bool)",
  "function account(address owner) view returns (tuple(uint256 balance, bool paused, address agent, uint256 perCallCap, uint256 dailyCap, uint256 dayIndex, uint256 spentToday))",
  "function isUsed(address merchant, bytes32 requestId) view returns (bool)",
  "function spentToday(address owner) view returns (uint256)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function setPolicy(address agent, uint256 perCallCap, uint256 dailyCap)",
  "function setMerchant(address merchant, bool allowed)",
  "function revokeAgent()",
  "function setPaused(bool paused)",
  "function pay(address owner, address merchant, bytes32 requestId, uint256 amount)",
  "event Deposited(address indexed owner, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed owner, uint256 amount, uint256 newBalance)",
  "event PolicySet(address indexed owner, address indexed agent, uint256 perCallCap, uint256 dailyCap)",
  "event MerchantSet(address indexed owner, address indexed merchant, bool allowed)",
  "event AgentRevoked(address indexed owner, address indexed agent)",
  "event PausedSet(address indexed owner, bool paused)",
  "event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount)",
  "error NotOwnerAgent()",
  "error Paused()",
  "error MerchantNotAllowed()",
  "error CapExceeded(uint256 cap, uint256 attempted)",
  "error DailyCapExceeded(uint256 cap, uint256 attempted)",
  "error RequestAlreadyUsed(bytes32 requestId)",
  "error InsufficientBalance()",
  "error DepositCapExceeded()",
  "error ZeroAmount()",
  "error ZeroAddress()",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
] as const;

/** Human text for the contract's custom errors (doc 07 error mapping). */
export const ERROR_TEXT: Record<string, string> = {
  NotOwnerAgent: "This agent is not authorised for that owner (revoked, or not the configured agent).",
  Paused: "The owner has paused this account. Payments are blocked, withdrawals still work.",
  MerchantNotAllowed: "That merchant is not on the owner's allowlist.",
  CapExceeded: "Over the per-call limit.",
  DailyCapExceeded: "Over the daily limit.",
  RequestAlreadyUsed: "This request ID was already paid. Replay refused.",
  InsufficientBalance: "Balance is too low for that amount.",
  DepositCapExceeded: "That deposit would exceed the per-account deposit cap.",
  ZeroAmount: "Amount must be greater than zero.",
  ZeroAddress: "An address is required.",
};
