// Copies the repository's evidence JSON into the app so it builds when deployed from apps/web alone (e.g. Vercel).
// When the repo-level evidence folder exists it is the source of truth; otherwise the committed copies are used.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../../evidence");
const dst = join(here, "../src/data/evidence-json");
mkdirSync(dst, { recursive: true });
if (existsSync(src)) {
  for (const f of ["deployment.json", "M3_mainnet_integration.json", "M4_mainnet_demo.json"]) copyFileSync(join(src, f), join(dst, f));
  console.log("evidence synced from repository");
} else console.log("using committed evidence copies");
