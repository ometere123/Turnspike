import deployment from "@/data/evidence-json/deployment.json";

/** Public configuration. Env overrides first, then the repository's own deployment evidence. No secrets live here. */
const env = (v: string | undefined, fallback: string) => (v && v.length > 0 ? v : fallback);

export const config = {
  chainId: Number(env(process.env.NEXT_PUBLIC_CHAIN_ID, String(deployment.chainId))),
  chainName: "QIE Mainnet",
  rpcUrl: env(process.env.NEXT_PUBLIC_RPC_URL, "https://rpc1mainnet.qie.digital"),
  explorer: env(process.env.NEXT_PUBLIC_EXPLORER_URL, "https://mainnet.qie.digital"),
  allowance: env(process.env.NEXT_PUBLIC_ALLOWANCE_ADDRESS, deployment.contract),
  qusdc: env(process.env.NEXT_PUBLIC_QUSDC_ADDRESS, deployment.token),
  merchant: env(process.env.NEXT_PUBLIC_MERCHANT_ADDRESS, deployment.merchant),
  deployBlock: Number(env(process.env.NEXT_PUBLIC_DEPLOY_BLOCK, String(deployment.block))),
  gatewayUrl: env(process.env.NEXT_PUBLIC_GATEWAY_URL, "https://turnspike-qie.fly.dev").replace(/\/$/, ""),
  repoUrl: env(process.env.NEXT_PUBLIC_REPO_URL, "https://github.com/ometere123/Turnspike").replace(/\/$/, ""),
  usdcDecimals: 6,
} as const;

export const deploymentEvidence = deployment;
export const explorerTx = (h: string) => `${config.explorer}/tx/${h}`;
export const explorerAddr = (a: string) => `${config.explorer}/address/${a}`;
export const repoFile = (p: string) => `${config.repoUrl}/blob/main/${p}`;
