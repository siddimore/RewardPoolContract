// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "hardhat/console.sol";

contract LPRewardToken is ERC20, AccessControl {
    // Remember to grant StakingManager MINTER_ROLE after its deployment
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor() ERC20("LPRewardToken", "LPReward") {
        // number of tokens minted = n * 10^18
        uint256 n = 1000;
        _mint(msg.sender, n * 10**uint(decimals()));
        console.log("Minted:", n * 10**uint(decimals()));
        //_mint(msg.sender, 4000000 * 10 ** decimals());
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
}