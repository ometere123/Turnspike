import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Compiler pinned per NFR-004 / 04 section 1 (evmVersion berlin until TEST-X03 is run).
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "berlin" },
  },
};
export default config;
