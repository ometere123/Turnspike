import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Compiler pinned per NFR-004 / 04 section 1 (evmVersion berlin until TEST-X03 is run).
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "berlin" },
  },
  networks: { qie: { url: "https://rpc1mainnet.qie.digital", chainId: 1990 } },
  etherscan: {
    apiKey: { qie: "no-key-needed" },
    customChains: [{ network: "qie", chainId: 1990, urls: { apiURL: "https://mainnet.qie.digital/api", browserURL: "https://mainnet.qie.digital" } }],
  },
  sourcify: { enabled: false },
};
export default config;
