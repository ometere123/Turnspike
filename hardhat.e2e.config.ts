import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Local chain that reports chain ID 1990, so the web app's network checks pass without touching mainnet. Test use only.
const config: HardhatUserConfig = {
  solidity: { version: "0.8.20", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "berlin" } },
  networks: { hardhat: { chainId: 1990 } },
};
export default config;
