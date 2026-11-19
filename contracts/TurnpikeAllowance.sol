// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TurnpikeAllowance
/// @notice Multi-tenant allowance vault. Each owner funds their own account and sets limits for one
///         agent key. The agent can only call `pay`; every other function acts on the caller's own
///         account (SEC-001). No admin, no upgrade, no rescue function (SEC-008).
contract TurnpikeAllowance is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Account {
        uint256 balance;
        bool paused;
        address agent;
        uint256 perCallCap;
        uint256 dailyCap;
        uint256 dayIndex;
        uint256 spentToday;
    }

    IERC20 public immutable token; // DATA-005
    uint256 public immutable depositCap; // DATA-004, per account, base units

    mapping(address => Account) private _accounts;
    mapping(address => mapping(address => bool)) public allowedMerchant; // owner => merchant
    mapping(address => mapping(bytes32 => bool)) private _used; // merchant => requestId

    error NotOwnerAgent();
    error Paused();
    error MerchantNotAllowed();
    error CapExceeded(uint256 cap, uint256 attempted);
    error DailyCapExceeded(uint256 cap, uint256 attempted);
    error RequestAlreadyUsed(bytes32 requestId);
    error InsufficientBalance();
    error DepositCapExceeded();
    error ZeroAmount();
    error ZeroAddress();

    event Deposited(address indexed owner, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed owner, uint256 amount, uint256 newBalance);
    event PolicySet(address indexed owner, address indexed agent, uint256 perCallCap, uint256 dailyCap);
    event MerchantSet(address indexed owner, address indexed merchant, bool allowed);
    event AgentRevoked(address indexed owner, address indexed agent);
    event PausedSet(address indexed owner, bool paused);
    event Paid(address indexed owner, address indexed agent, address indexed merchant, bytes32 requestId, uint256 amount);

    constructor(IERC20 token_, uint256 depositCap_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        depositCap = depositCap_;
    }

    // ------------------------------------------------ owner functions (act on msg.sender only)

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        uint256 newBalance = a.balance + amount;
        if (newBalance > depositCap) revert DepositCapExceeded();
        a.balance = newBalance; // effects before interaction
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, newBalance);
    }

    function setPolicy(address agent, uint256 perCallCap, uint256 dailyCap) external {
        if (agent == address(0)) revert ZeroAddress();
        Account storage a = _accounts[msg.sender];
        a.agent = agent;
        a.perCallCap = perCallCap;
        a.dailyCap = dailyCap;
        emit PolicySet(msg.sender, agent, perCallCap, dailyCap);
    }

    function setMerchant(address merchant, bool allowed) external {
        allowedMerchant[msg.sender][merchant] = allowed;
        emit MerchantSet(msg.sender, merchant, allowed);
    }

    function revokeAgent() external {
        Account storage a = _accounts[msg.sender];
        address old = a.agent;
        a.agent = address(0);
        emit AgentRevoked(msg.sender, old);
    }

    function setPaused(bool paused_) external {
        _accounts[msg.sender].paused = paused_;
        emit PausedSet(msg.sender, paused_);
    }

    /// @dev Never blocked by pause or revoke (FR-009, SEC-007).
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        if (amount > a.balance) revert InsufficientBalance();
        a.balance -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, a.balance);
    }

    // ------------------------------------------------ agent function

    function pay(address owner, address merchant, bytes32 requestId, uint256 amount) external nonReentrant {
        Account storage a = _accounts[owner];
        if (a.paused) revert Paused();
        if (a.agent == address(0) || msg.sender != a.agent) revert NotOwnerAgent();
        if (!allowedMerchant[owner][merchant]) revert MerchantNotAllowed();
        if (amount == 0) revert ZeroAmount();
        if (amount > a.perCallCap) revert CapExceeded(a.perCallCap, amount);

        uint256 today = block.timestamp / 1 days;
        uint256 spent = a.dayIndex == today ? a.spentToday : 0;
        if (spent + amount > a.dailyCap) revert DailyCapExceeded(a.dailyCap, spent + amount);

        if (_used[merchant][requestId]) revert RequestAlreadyUsed(requestId);
        if (amount > a.balance) revert InsufficientBalance();

        // effects
        _used[merchant][requestId] = true;
        a.dayIndex = today;
        a.spentToday = spent + amount;
        a.balance -= amount;

        // interaction
        token.safeTransfer(merchant, amount);
        emit Paid(owner, msg.sender, merchant, requestId, amount);
    }

    // ------------------------------------------------ views (FR-010)

    function account(address owner) external view returns (Account memory) {
        return _accounts[owner];
    }

    function isUsed(address merchant, bytes32 requestId) external view returns (bool) {
        return _used[merchant][requestId];
    }

    function spentToday(address owner) external view returns (uint256) {
        Account storage a = _accounts[owner];
        return a.dayIndex == block.timestamp / 1 days ? a.spentToday : 0;
    }
}
