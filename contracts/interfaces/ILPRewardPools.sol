// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface ILPRewardPools {
  function stake(address tokenAddress, uint256 amount) external;
  function unstake(address tokenAddress, uint256 amount) external;
}