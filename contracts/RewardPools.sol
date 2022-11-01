// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./interfaces/IRewardPools.sol";
import "hardhat/console.sol";

abstract contract RewardPools is IRewardPools, Initializable, PausableUpgradeable, AccessControlUpgradeable {

    using SafeERC20Upgradeable for IERC20Upgradeable;
    IERC20Upgradeable internal _rewardToken;
    IERC20Upgradeable internal _sFiefToken;
    uint256 _totalRewardAmountPerBlock;
    uint256 _totalRewardAmountForPool;
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public defaultRewardPoolWithdrawalFee;
    /// Role for managing this contract
    bytes32 public constant MANAGE_COLLECTED_FEES_ROLE = keccak256("MANAGE_COLLECTED_FEES_ROLE");
    bytes32 public constant MANAGE_REWARD_POOLS_ROLE = keccak256("MANAGE_REWARD_POOLS_ROLE");

    // Constant that facilitates handling of token fractions
    uint256 constant _DIV_PRECISION = 1e18;

    /// contains information about a specific reward pool
    struct RewardPool {
      address tokenAddress; // token the pool is created for
      uint256 minSFiefBalance;
      uint256 minStakeAmount; // minimum amount that must be staked per account 
      uint256 totalStakedAmount;
      uint256 totalRewardAmountPerBlock; // sum of rewards assigned to this reward pool
      uint256 accRewardPerShare; // the amount of unclaimedRewards rewards per share of the staking pool
      uint256 lastRewardAmount; // sum of all rewards in this reward pool from last calculation
      uint256 rewardPoolStartBlockNumber;
      uint256 lastRewardedBlock; // Last block number the user had their rewards calculated
      uint256 withdrawalFee; // withdrawal fee
      uint256 performanceFee; // performance fee
      bool exists; // flag to show if this reward pool exists already
    }

    struct StakedInfo {
      uint256 balance; // amount of staked tokens
      uint256 stakeUpdateTime;
      uint256 lastRewardedBlock; // timestamp of last update
      uint256 rewardDebt; // a negative reward amount that ensures that claimRewards cannot be called repeatedly to drain the rewards
      address tokenAddress; // the token address of the underlying token of a specific reward pool
    }


    /// stores the reward pool information for each token that is supported by the lp
    /// tokenAddress to reward pool
    mapping(address => RewardPool) public rewardPools;

    /// Stores current stakings
    /// there is a mapping from user wallet address to StakedInfo for each reward pool
    /// tokenAddress (RewardPool) => Staker wallet address as identifier => StakedInfo
    mapping(address => mapping(address => StakedInfo)) public stakes;


    event RewardPoolCreated(address indexed tokenAddress);
    event RewardClaimed(address indexed staker, address indexed tokenAddress, uint256 amount);

    function initialize(
      address rewardTokenAddress,
      address sFiefTokenAddress,
      uint256 totalRewardAmountPerBlock) initializer public virtual {
        __Pausable_init();
        __AccessControl_init();

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE, msg.sender);
        _rewardToken = IERC20Upgradeable(rewardTokenAddress);
        _sFiefToken = IERC20Upgradeable(sFiefTokenAddress);
        _totalRewardAmountPerBlock = totalRewardAmountPerBlock;
        defaultRewardPoolWithdrawalFee = 100000; // 10%
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

      /**
   * @notice Sets the minimum stake amount for a specific token
   *
   * @dev can only be called by MANAGE_REWARD_POOLS_ROLE
   * @param tokenAddress the address of the underlying token of the reward pool
   * @param _minStakeAmount the minimum staking amount
   */
  function setMinStakeAmount(address tokenAddress, uint256 _minStakeAmount) external {
    require(
      hasRole(MANAGE_REWARD_POOLS_ROLE, _msgSender()),
      "RewardPools: must have MANAGE_REWARD_POOLS_ROLE role to execute this function"
    );
    require(rewardPools[tokenAddress].exists, "RewardPools: rewardPool does not exist");
    rewardPools[tokenAddress].minStakeAmount = _minStakeAmount;
  }

  /**
   * @notice Sets an individual reward pool withdrawal fee for the given token
   *
   * @dev can only be called by MANAGE_COLLECTED_FEES_ROLE
   * @param tokenAddress the address of the underlying token contract
   * @param fee the individual reward pool withdrawal fee rate provided in ppm: parts per million - 10,000ppm = 1%
   */
  function setRewardPoolWithdrawalFee(address tokenAddress, uint256 fee) external {
    require(
      hasRole(MANAGE_COLLECTED_FEES_ROLE, _msgSender()),
      "RewardPools: must have MANAGE_COLLECTED_FEES_ROLE role to execute this function"
    );
    require(rewardPools[tokenAddress].exists, "RewardPools: rewardPool does not exist");
    rewardPools[tokenAddress].withdrawalFee = fee;
  }

    /**
   * @notice Sets an individual reward pool withdrawal fee for the given token
   *
   * @dev can only be called by MANAGE_COLLECTED_FEES_ROLE
   * @param tokenAddress the address of the underlying token contract
   * @param fee the individual reward pool withdrawal fee rate provided in ppm: parts per million - 10,000ppm = 1%
   */
  function setRewardPoolPerformanceFee(address tokenAddress, uint256 fee) external {
    require(
      hasRole(MANAGE_COLLECTED_FEES_ROLE, _msgSender()),
      "RewardPools: must have MANAGE_COLLECTED_FEES_ROLE role to execute this function"
    );
    require(rewardPools[tokenAddress].exists, "RewardPools: rewardPool does not exist");
    rewardPools[tokenAddress].performanceFee = fee;
  }

  /**
   * @notice Adds additional rewards to a reward pool (e.g. as additional incentive to provide liquidity to this pool)
   *
   * @param tokenAddress the address of the underlying token of the reward pool (must be an IERC20 contract)
   * @param totalRewardAmount the amount of additional rewards (in the underlying token)
   * @dev emits event RewardsAdded
   */
  // TODO: make minStakeAmount, maxStakeAmount, totalRewardAmountPerBlock as parameters
function createRewardPool(
  address tokenAddress, 
  uint256 totalRewardAmountPerBlock, 
  uint256 numberOfBlocks, 
  uint256 totalRewardAmount,
  uint256 blockNumber,
  uint256 minSFiefBalance) external returns (bool){
    // TODO: Add a role who can create
    // Also identify what tokenaddress to be supported for RewatrdPools
    // check input parameters
    require(tokenAddress != address(0), "RewardPools: invalid address provided");

    if (totalRewardAmount != 0) {
      uint256 estimatedRewardAmount = totalRewardAmountPerBlock * numberOfBlocks;
      if (estimatedRewardAmount < totalRewardAmount) {
        return false;
      }
    }

    // check if reward pool for given token exists
    if (!rewardPools[tokenAddress].exists) {
      // reward pool does not yet exist - create new reward pool
      // TBD Override all below variables of RewardPool
      rewardPools[tokenAddress] = RewardPool({
        tokenAddress: tokenAddress,
        minSFiefBalance: minSFiefBalance,
        minStakeAmount: 1,
        totalStakedAmount: 0,
        totalRewardAmountPerBlock: totalRewardAmountPerBlock == 0 ? _totalRewardAmountPerBlock : totalRewardAmountPerBlock,
        accRewardPerShare: 0,
        lastRewardAmount: 0,
        rewardPoolStartBlockNumber: blockNumber,
        lastRewardedBlock: 0,
        withdrawalFee: 0,
        performanceFee: 0,
        exists: true
      });
    }

    // TODO: Add rewardtoken to this contract the total amout
    _rewardToken.safeTransfer(address(this), totalRewardAmount);
    // update the total reward amount for this reward pool
    // rewardPools[tokenAddress].totalRewardAmountPerBlock = rewardPools[tokenAddress].totalRewardAmountPerBlock + amount;

    emit RewardPoolCreated(tokenAddress);
    return rewardPools[tokenAddress].exists;
  }

  function getlastRewardedBlockBlockNumber(address tokenAddress) public view virtual returns(uint256){
    return rewardPools[tokenAddress].lastRewardedBlock;
  }

  /**
   * @notice Updates the reward calculations for the given reward pool  (e.g. rewardPerShare)
   *
   * @param tokenAddress the address of the underlying token
   */
  function updatePoolRewards(address tokenAddress) public {
      console.log("***** Calling Update Pool Rewards ***********");
      RewardPool storage pool = rewardPools[tokenAddress];

      // check if reward pool has any staked funds
      if (pool.totalStakedAmount == 0) {
            pool.lastRewardedBlock = block.number;
            return;
        }
      // check if amount of unclaimedRewards rewards is bigger than last reward amount
      if (pool.totalStakedAmount > 0) {
        uint256 blockNumber = block.number;
        uint256 previousRewardBlock = pool.lastRewardedBlock;
        uint256 blocksSinceLastReward = block.number - previousRewardBlock;
        uint256 rewards = blocksSinceLastReward * pool.totalRewardAmountPerBlock;
        console.log("UpdatePoolRewards:rewards", rewards);
        uint256 accRewardPerShare = pool.accRewardPerShare + 
          (rewards * _DIV_PRECISION / pool.totalStakedAmount);
        console.log("UpdatePoolRewards:accRewardPerShare", accRewardPerShare);
        console.log("UpdatePoolRewards:StakeBalance", blocksSinceLastReward);
        console.log("**********************************************************");
        pool.accRewardPerShare =
          pool.accRewardPerShare + (rewards * _DIV_PRECISION / pool.totalStakedAmount);
        pool.lastRewardAmount = rewards;
        pool.lastRewardedBlock = block.number;
      }
  }

  /**
   * @notice Distributes staking rewards
   *
   * @param tokenAddress the address of the underlying token of the reward pool
   * @param stakerAddress the address for which the rewards should be distributed
   * @dev emits event RewardClaimed
   */
  function claimReward(address tokenAddress, address stakerAddress) public virtual {
    uint256 rewardAmount = _claimReward(tokenAddress, stakerAddress);

    if (rewardAmount > 0) {
      // safely transfer the reward amount to the staker address
      _rewardToken.safeTransfer(stakerAddress, rewardAmount);

      // Distribute emit event
      emit RewardClaimed(stakerAddress, tokenAddress, rewardAmount);
    }
  }

  function _claimReward(address tokenAddress, address stakerAddress) internal returns (uint256) {
    // get staker info and check if such a record exists
    StakedInfo storage staker = stakes[tokenAddress][stakerAddress];
    require(staker.balance > 0, "RewardPools: Staker has a balance of 0");

    // update the reward pool calculations (e.g. rewardPerShare)
    updatePoolRewards(tokenAddress);

    // calculate reward amount
    // Double check formulas
    // console.log("AccRewardPerShare", rewardPools[staker.tokenAddress].accRewardPerShare);
    console.log("StakeTokenAddress",staker.tokenAddress);
    console.log("AccRewardPerShare", rewardPools[staker.tokenAddress].accRewardPerShare);
    console.log("StakerBalance", staker.balance);
    uint256 accumulated = (staker.balance * rewardPools[staker.tokenAddress].accRewardPerShare) / _DIV_PRECISION;
    console.log("AccumulatedRewards %s, StakerAddress %s",accumulated,stakerAddress);
    uint256 rewardAmount = uint256(accumulated - staker.rewardDebt);
    console.log("RewardAmount, StakerAddress %s",rewardAmount, stakerAddress);

    // Save the current share of the pool as reward debt to prevent a staker from harvesting again (similar to re-entry attack)
    staker.rewardDebt = accumulated;

    return rewardAmount;
  }

}