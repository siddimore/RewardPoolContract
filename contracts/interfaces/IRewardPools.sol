// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;


interface IRewardPools {
  function createRewardPool(
    address tokenAddress, 
    uint256 totalRewardAmountPerBlock, 
    uint256 numberOfBlocks, 
    uint256 totalRewardAmount,
    uint256 blockNumber,
    uint256 minSFiefBalance) external returns (bool);
  function claimReward(address tokenAddress, address stakerAddress) external;
  function updatePoolRewards(address tokenAddress) external;
}
