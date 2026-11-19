// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev TEST DOUBLE ONLY (labelled mock for TEST-C*). Never deployed to mainnet.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock QUSDC", "mQUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}
