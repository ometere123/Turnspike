import { isAddress } from "ethers";

/**
 * What the owner sees must be exactly what the contract receives. ethers also accepts ICAP and un-prefixed forms and
 * silently converts them, so the console requires the plain 0x form (with a valid checksum when mixed case).
 */
export const isHexAddress = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a) && isAddress(a);
