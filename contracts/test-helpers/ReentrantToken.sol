// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVault {
    function withdraw(uint256) external;
    function pay(address, address, bytes32, uint256) external;
}

/// @dev TEST DOUBLE ONLY (TEST-C12): token that calls back into the vault during a transfer out.
contract ReentrantToken is ERC20 {
    IVault public vault;
    uint8 public mode; // 1 = reenter withdraw, 2 = reenter pay
    address public target;
    bytes32 public rid;
    bool private _in;
    bool public reentryReverted;

    constructor() ERC20("Evil", "EVL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        _mint(to, a);
    }

    function arm(address v, uint8 m, address t, bytes32 r) external {
        vault = IVault(v);
        mode = m;
        target = t;
        rid = r;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (mode != 0 && !_in && from == address(vault)) {
            _in = true;
            // Record whether the vault blocked the re-entrant call, then continue the outer transfer.
            if (mode == 1) {
                try vault.withdraw(1) {} catch { reentryReverted = true; }
            } else {
                try vault.pay(target, to, rid, 1) {} catch { reentryReverted = true; }
            }
            _in = false;
        }
    }
}
