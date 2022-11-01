// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "./RewardPools.sol";
import "./interfaces/ILPRewardPools.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract LPRewardPools is ILPRewardPools, RewardPools {

  using SafeERC20Upgradeable for IERC20Upgradeable;
  event StakeAdded(address indexed accountAddress, address indexed tokenAddress, uint256 amount);

  event StakeWithdrawn(address indexed accountAddress, address indexed tokenAddress, uint256 amount);
  

  function initialize(
    address rewardTokenAddress, 
    address sFiefTokenAddress, 
    uint256 totalRewardAmountPerBlock) initializer override public {

    _rewardToken = IERC20Upgradeable(rewardTokenAddress);
    _sFiefToken = IERC20Upgradeable(sFiefTokenAddress);
    _totalRewardAmountPerBlock = totalRewardAmountPerBlock;

    // TBD fix this value 
    defaultRewardPoolWithdrawalFee = 300000; // 30%
  }

  /**
   * @notice Adds new funds (lp tokens) to the staking pool
   *
   * @param tokenAddress the address of the underlying token
   * @param amount the amount of lp tokens that should be staked
   * @dev emits event StakeAdded
   */
  function stake(address tokenAddress, uint256 amount) external {
    // get reward pool for the given token
    RewardPool storage pool = rewardPools[tokenAddress];

    // get info about existing stakings in this token by this user (if any)
    StakedInfo storage staker = stakes[tokenAddress][_msgSender()];

    // check input parameters
    require(amount > 0, "RewardPools: staking amount cannot be 0");
    require(pool.exists, "RewardPools: rewardPool does not exist");
    require(amount >= pool.minStakeAmount, "RewardPools: staking amount too small");
    require(_sFiefToken.balanceOf(_msgSender()) > pool.minSFiefBalance, "Not enough SFIEIF Balance");

    // re-calculate the current rewards and accumulatedRewardsPerShare for this pool before staking
    updatePoolRewards(tokenAddress);

    // check if any rewards are available
    if (staker.balance > 0) {
      claimReward(tokenAddress, _msgSender());
    }

    console.log("LPRewardPools:stake:blocknumber %s for stakeraddress %s",(block.number), _msgSender());

    // Update staker info
    staker.stakeUpdateTime = block.timestamp;
    staker.balance = staker.balance + amount;
    staker.tokenAddress = tokenAddress;

    // Assign reward debt in full amount of stake
    staker.rewardDebt = (staker.balance * pool.accRewardPerShare) / _DIV_PRECISION;

    // Update total staked amount in reward pool info
    rewardPools[tokenAddress].totalStakedAmount = pool.totalStakedAmount + amount;

    // transfer to-be-staked funds from user to this smart contract
    IERC20Upgradeable(tokenAddress).safeTransferFrom(_msgSender(), address(this), amount);

    // funds successfully staked - emit event
    emit StakeAdded(_msgSender(), tokenAddress, amount);
  }


  /**
   * @notice Withdraws staked funds (lp tokens) from the reward pool after available rewards, if any
   *
   * @param tokenAddress the address of the underlying token of the reward pool
   * @param amount the amount of lp tokens that should be unstaked
   * @dev emits event StakeAdded
   */
  function unstake(address tokenAddress, uint256 amount) external {
    // get reward pool for the given token
    RewardPool storage pool = rewardPools[tokenAddress];

    // get info about existing stakings in this token by this user (if any)
    StakedInfo storage staker = stakes[tokenAddress][_msgSender()];

    // check input parameters
    require(amount > 0, "RewardPools: amount to be unstaked cannot be 0");
    require(pool.exists, "RewardPools: rewardPool does not exist");
    require(staker.balance >= amount, "RewardPools: amount exceeds available balance");
    if (staker.balance - amount != 0) {
      // check if remaining balance is above min stake amount
      require(
        staker.balance - amount >= pool.minStakeAmount,
        "RewardPools: remaining balance below minimum stake amount"
      );
    }

    // claimRewards available rewards before unstaking, if any
    claimReward(tokenAddress, _msgSender());

    // Update staker info
    staker.stakeUpdateTime = block.timestamp;
    staker.balance = staker.balance - amount;
    staker.rewardDebt = (staker.balance * pool.accRewardPerShare) / _DIV_PRECISION;

    // Update pool
    pool.totalStakedAmount = pool.totalStakedAmount - amount;

    // // determine the reward pool withdrawal fee (usually the default rate)
    // // if a specific fee rate is stored for this reward pool then we use this rate instead
    uint256 relativeFee = pool.exists
      ? pool.withdrawalFee
      : defaultRewardPoolWithdrawalFee;
    uint256 withdrawFeeAmount = (amount * relativeFee) / 1000000;
    uint256 transferAmount = amount - withdrawFeeAmount;
    console.log("LPRewardPool:Unstake", transferAmount);
    console.log("LPRewardPool:Unstake", _msgSender());

    // transfer lp tokens back to user
    IERC20Upgradeable(tokenAddress).safeTransfer(_msgSender(), amount - withdrawFeeAmount);
    // funds successfully unstaked - emit new event
    emit StakeWithdrawn(_msgSender(), tokenAddress, amount - withdrawFeeAmount);
  }

    /**
   * @notice Distributes staking rewards
   *
   * @param tokenAddress the address of the underlying token of the reward pool
   * @param stakerAddress the address for which the rewards should be distributed
   * @dev emits event RewardClaimed
   */
  function claimReward(address tokenAddress, address stakerAddress) public override {
    // re-calculate the current rewards and accumulatedRewardsPerShare for this pool before staking
    uint256 rewardAmount = _claimReward(tokenAddress, stakerAddress);

      if (rewardAmount > 0) {
      console.log("ClaimReward:RewardBalance", _rewardToken.balanceOf(address(this)) / _DIV_PRECISION);
      _rewardToken.safeTransfer(stakerAddress, rewardAmount);
      // Distribute emit event
      emit RewardClaimed(stakerAddress, tokenAddress, rewardAmount);
    }
  }
}