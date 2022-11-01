import { assert, expect } from "chai";
import { upgrades, ethers } from "hardhat";
import { BigNumber, ContractTransaction } from "ethers";
import { solidityKeccak256 } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { LPRewardToken, LPRewardPools, ERC20Mock } from "../typechain";

class LPRewardPoolDeployedTransaction {
  rewardPoolDeployedTransaction: ContractTransaction;
  startingBlockNumber: number;
  constructor(inputTransaction, inputStartingBlockNumber) {
    this.rewardPoolDeployedTransaction = inputTransaction;
    this.startingBlockNumber = inputStartingBlockNumber;
  }
}

async function grantRewardTokenMinterRole(
  lpRewardPoolsAddress: string,
  rewardToken: LPRewardToken
) {
  const transaction = await rewardToken.grantRole(
    solidityKeccak256(["string"], ["MINTER_ROLE"]),
    lpRewardPoolsAddress
  );
  return await transaction.wait();
}

async function deployLPToken(): Promise<ERC20Mock> {
  const LPToken = await ethers.getContractFactory("ERC20Mock");
  const lpToken = await LPToken.deploy("lptoken", "lp");
  await lpToken.deployed();
  return lpToken;
}

async function deploySFiefToken(): Promise<ERC20Mock> {
  const LPToken = await ethers.getContractFactory("ERC20Mock");
  const lpToken = await LPToken.deploy("Staked Fief Token", "sFIEF");
  await lpToken.deployed();
  return lpToken;
}

async function deployRewardToken(): Promise<LPRewardToken> {
  const RewardToken = await ethers.getContractFactory("LPRewardToken");
  const rewardToken = await RewardToken.deploy();
  await rewardToken.deployed();
  return rewardToken;
}

async function deployRewardPoolsContract(
  rewardTokenAddress: string,
  sFiefTokenAddress: string,
  rewardTokensPerBlock: BigNumber
): Promise<LPRewardPools> {
  const LPRewardPools = await ethers.getContractFactory("LPRewardPools");
  const lpRewardPoolContract = await upgrades.deployProxy(
    LPRewardPools,
    [rewardTokenAddress, sFiefTokenAddress, 1],
    { initializer: "initialize" }
  );
  console.log(lpRewardPoolContract.address);
  await lpRewardPoolContract.deployed();
  return lpRewardPoolContract;
}

async function createRewardPool(
  lpRewardPools: LPRewardPools,
  stakeTokenAddress: string,
  minSfiefAmout: number = 0
) {
  const rewardTokensPerBlock = ethers.utils.parseEther("1");
  const startingBlockNumber = await ethers.provider.getBlockNumber();
  const createRewardPoolTransaciton = await lpRewardPools.createRewardPool(
    stakeTokenAddress,
    rewardTokensPerBlock,
    1,
    1,
    startingBlockNumber,
    minSfiefAmout
  );

  const lpRewardPoolDeployment = new LPRewardPoolDeployedTransaction(
    createRewardPoolTransaciton,
    startingBlockNumber
  );

  return lpRewardPoolDeployment;
}

describe("LPRewardPools", function () {
  let rewardToken: LPRewardToken;
  let lpToken: ERC20Mock;
  let sFief: ERC20Mock;
  let lpRewardPoolManager: LPRewardPools;
  let account1: SignerWithAddress;
  // eslint-disable-next-line no-unused-vars
  let account2: SignerWithAddress;
  let account3: SignerWithAddress;
  let account4: SignerWithAddress;

  const rewardTokensPerBlock = ethers.utils.parseEther("1");

  this.beforeEach(async () => {
    rewardToken = await deployRewardToken();
    lpToken = await deployLPToken();
    sFief = await deploySFiefToken();
    lpRewardPoolManager = await deployRewardPoolsContract(
      lpToken.address,
      sFief.address,
      rewardTokensPerBlock
    );
    await grantRewardTokenMinterRole(lpRewardPoolManager.address, lpToken);
    [account1, account2, account3, account4] = await ethers.getSigners();
    await lpToken.transfer(
      lpRewardPoolManager.address,
      ethers.utils.parseEther("1000")
    );

    await sFief.transfer(account1.address, ethers.utils.parseEther("1000"));
    await sFief.transfer(account2.address, ethers.utils.parseEther("1000"));
    await sFief.transfer(account3.address, ethers.utils.parseEther("1000"));
  });

  it("Creates a new pool", async function () {
    // console.log()
    const output = await createRewardPool(lpRewardPoolManager, lpToken.address);
    await expect(output.rewardPoolDeployedTransaction)
      .to.emit(lpRewardPoolManager, "RewardPoolCreated")
      .withArgs(lpToken.address);
  });

  it("Deposits a token in the first pool", async function () {
    // Arrange
    const stakeToken = lpToken;
    await createRewardPool(lpRewardPoolManager, lpToken.address);
    const amount = ethers.utils.parseEther("1");
    await lpToken.approve(lpRewardPoolManager.address, amount);

    const lpRewardPoolManagerPreviousBalance = await lpToken.balanceOf(
      lpRewardPoolManager.address
    );

    // Act
    const depositTransaction = await lpRewardPoolManager.stake(
      stakeToken.address,
      amount
    );

    // Assert
    await expect(depositTransaction)
      .to.emit(lpRewardPoolManager, "StakeAdded")
      .withArgs(account1.address, lpToken.address, amount);

    const lpRewardPoolManagerBalance = await lpToken.balanceOf(
      lpRewardPoolManager.address
    );
    console.log(lpRewardPoolManagerBalance);

    // Expect LpRewardPoolManager Balance equals RewardBalance + Deposited Token amount
    expect(lpRewardPoolManagerBalance).to.be.equal(
      lpRewardPoolManagerPreviousBalance.add(amount)
    );
  });

  it("Withdraw all tokens from a pool", async function () {
    // Arrange
    const stakeToken = lpToken;
    const rewardPoolCreatedTransaciton = await createRewardPool(
      lpRewardPoolManager,
      stakeToken.address
    );
    const amount = 20;
    await stakeToken.approve(lpRewardPoolManager.address, amount);

    const startingBlockNumber =
      rewardPoolCreatedTransaciton.startingBlockNumber;
    console.log("StartingBlockNumber:Test", startingBlockNumber);

    // Act
    const depositTransaction = await lpRewardPoolManager.stake(
      stakeToken.address,
      amount
    );

    const lpRewardPoolManagerPreviousBalance = await lpToken.balanceOf(
      lpRewardPoolManager.address
    );

    console.log(
      "StakingManagerBalance:lpRewardPoolManagerPreviousBalance",
      lpRewardPoolManagerPreviousBalance
    );
    // Assert
    await expect(depositTransaction)
      .to.emit(lpRewardPoolManager, "StakeAdded")
      .withArgs(account1.address, stakeToken.address, amount);

    // Act
    const withDrawAmount = 20;
    const withdrawTransaction = await lpRewardPoolManager.unstake(
      stakeToken.address,
      withDrawAmount
    );

    // Assert
    await expect(withdrawTransaction)
      .to.emit(lpRewardPoolManager, "StakeWithdrawn")
      .withArgs(account1.address, stakeToken.address, withDrawAmount);

    const lpRewardPoolManagerBalance = await stakeToken.balanceOf(
      lpRewardPoolManager.address
    );

    console.log(
      "StakingManagerBalance:",
      ethers.utils.formatEther(lpRewardPoolManagerBalance)
    );
    console.log(
      "StakingManagerBalance:lpRewardPoolManagerPreviousBalance",
      ethers.utils.formatEther(lpRewardPoolManagerPreviousBalance)
    );

    const blocksPassedBetweenStakeAndReward = 1;
    console.log(
      "blocksPassed Between Stake And Reward",
      blocksPassedBetweenStakeAndReward
    );
    const rewards = rewardTokensPerBlock.mul(blocksPassedBetweenStakeAndReward);
    console.log("Rewards:", ethers.utils.formatEther(rewards));

    expect(lpRewardPoolManagerBalance).to.be.equal(
      lpRewardPoolManagerPreviousBalance.sub(rewards).sub(withDrawAmount)
    );
  });

  it("Withdraw some tokens from pool and claim rewards", async function () {
    // Arrange
    const stakeToken = lpToken;
    const rewardPoolCreatedTransaciton = await createRewardPool(
      lpRewardPoolManager,
      stakeToken.address
    );
    const amount = 20;
    await stakeToken.approve(lpRewardPoolManager.address, amount);

    const startingBlockNumber =
      rewardPoolCreatedTransaciton.startingBlockNumber;

    // Act
    const depositTransaction = await lpRewardPoolManager.stake(
      stakeToken.address,
      amount
    );

    const lpRewardPoolManagerPreviousBalance = await lpToken.balanceOf(
      lpRewardPoolManager.address
    );

    console.log(
      "StakingManagerBalance:lpRewardPoolManagerPreviousBalance",
      lpRewardPoolManagerPreviousBalance
    );
    // Assert
    await expect(depositTransaction)
      .to.emit(lpRewardPoolManager, "StakeAdded")
      .withArgs(account1.address, stakeToken.address, amount);

    // Act
    const withDrawAmount = 10;
    const withdrawTransaction = await lpRewardPoolManager.unstake(
      stakeToken.address,
      withDrawAmount
    );

    // Assert
    await expect(withdrawTransaction)
      .to.emit(lpRewardPoolManager, "StakeWithdrawn")
      .withArgs(account1.address, stakeToken.address, withDrawAmount);

    const lpRewardPoolManagerBalance = await stakeToken.balanceOf(
      lpRewardPoolManager.address
    );

    console.log(
      "StakingManagerBalance:",
      ethers.utils.formatEther(lpRewardPoolManagerBalance)
    );
    console.log(
      "StakingManagerBalance:lpRewardPoolManagerPreviousBalance",
      ethers.utils.formatEther(lpRewardPoolManagerPreviousBalance)
    );

    const blocksPassedBetweenStakeAndReward = 1;
    console.log(
      "blocksPassed Between Stake And Reward",
      blocksPassedBetweenStakeAndReward
    );
    const rewards = rewardTokensPerBlock.mul(blocksPassedBetweenStakeAndReward);
    console.log("Rewards:", ethers.utils.formatEther(rewards));

    expect(lpRewardPoolManagerBalance).to.be.equal(
      lpRewardPoolManagerPreviousBalance.sub(rewards).sub(withDrawAmount)
    );
  });

  it("Claim rewards according with the staker pool's share", async function () {
    // Arrange Pool
    const stakeToken = lpToken;
    await stakeToken.transfer(
      account2.address,
      ethers.utils.parseEther("200000") // 200.000
    );
    const rewardPoolCreatedTransaciton = await createRewardPool(
      lpRewardPoolManager,
      stakeToken.address
    );
    const startingBlockNumber = rewardPoolCreatedTransaciton.startingBlockNumber;

    const amount1 = ethers.utils.parseEther("80");
    const amount2 = ethers.utils.parseEther("20");

    // Arrange Account1 staking
    await stakeToken.approve(lpRewardPoolManager.address, amount1);
    await lpRewardPoolManager.stake(lpToken.address, amount1);

    // Arrange Account 2 staking
    await stakeToken
      .connect(account2)
      .approve(lpRewardPoolManager.address, amount2);
    await lpRewardPoolManager.connect(account2).stake(lpToken.address, amount2);

    // Act
    // Acc1 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc1ClaimRewardTransaction = await lpRewardPoolManager.claimReward(
      lpToken.address,
      account1.address
    );
    console.log(
      "acc1ClaimRewardTransaction:Blocknumber",
      acc1ClaimRewardTransaction.blockNumber
    );

    // Acc2 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc2ClaimRewardTransaction = await lpRewardPoolManager.claimReward(
      lpToken.address,
      account2.address
    );
    console.log(
      "acc2Transaction:Blocknumber",
      acc2ClaimRewardTransaction.blockNumber
    );

    // const startingBlockNumber =
    const endingBlockNumber = await ethers.provider.getBlockNumber();
    console.log("endingBlockNumber", endingBlockNumber);

    // Assert
    // 2 blocks with 100% participation = 1 reward tokens * 2 blocks = 2 // ClaimReward for Acc1 done 2 blocks after adding stake
    // 1 block with 80% participation = 0.8 reward tokens * 1 block = 0.8 // 2nd ClaimReward for Acc1 is 80 percent of entire reward
    // Account1 Total = 2 + 0.8 = 2.8 reward tokens
    console.log("Test:StartingBlockNumber", startingBlockNumber);
    const expectedAccount1Rewards = ethers.utils.parseEther("2.8");
    await expect(acc1ClaimRewardTransaction)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(account1.address, lpToken.address, expectedAccount1Rewards);

    // ClaimReward for Acc2 done 2 blocks after adding stake
    // 2 block with 20% participation = 0.2 reward tokens * 2 block
    // Account 2 Total = 0.4 reward tokens
    const expectedAccount2Rewards = ethers.utils.parseEther("0.4");
    await expect(acc2ClaimRewardTransaction)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(account2.address, lpToken.address, expectedAccount2Rewards);
  });


  it("Claim rewards according with the staker pool's share and then withdraw", async function () {
    // Arrange Pool
    const stakeToken = lpToken;
    await stakeToken.transfer(
      account2.address,
      ethers.utils.parseEther("200000") // 200.000
    );
    await stakeToken.transfer(
      account3.address,
      ethers.utils.parseEther("200000") // 200.000
    );
    const rewardPoolCreatedTransaciton = await createRewardPool(
      lpRewardPoolManager,
      stakeToken.address
    );
    const startingBlockNumber = rewardPoolCreatedTransaciton.startingBlockNumber;

    const amount1 = ethers.utils.parseEther("80");
    const amount2 = ethers.utils.parseEther("20");

    // Arrange Account1 staking
    await stakeToken.approve(lpRewardPoolManager.address, amount1);
    await lpRewardPoolManager.stake(lpToken.address, amount1);

    // Arrange Account 2 staking
    await stakeToken
      .connect(account2)
      .approve(lpRewardPoolManager.address, amount2);
    await lpRewardPoolManager.connect(account2).stake(lpToken.address, amount2);

    // Act
    // Acc1 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc1ClaimRewardTransaction = await lpRewardPoolManager.claimReward(
      lpToken.address,
      account1.address
    );
    console.log(
      "acc1ClaimRewardTransaction:Blocknumber",
      acc1ClaimRewardTransaction.blockNumber
    );

    // Acc2 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc2ClaimRewardTransaction = await lpRewardPoolManager.claimReward(
      lpToken.address,
      account2.address
    );
    console.log(
      "acc2Transaction:Blocknumber",
      acc2ClaimRewardTransaction.blockNumber
    );

    // const startingBlockNumber =
    const endingBlockNumber = await ethers.provider.getBlockNumber();
    console.log("endingBlockNumber", endingBlockNumber);

    // Assert
    // 2 blocks with 100% participation = 1 reward tokens * 2 blocks = 2 // ClaimReward for Acc1 done 2 blocks after adding stake
    // 1 block with 80% participation = 0.8 reward tokens * 1 block = 0.8 // 2nd ClaimReward for Acc1 is 80 percent of entire reward
    // Account1 Total = 2 + 0.8 = 2.8 reward tokens
    console.log("Test:StartingBlockNumber", startingBlockNumber);
    const expectedAccount1Rewards = ethers.utils.parseEther("2.8");
    await expect(acc1ClaimRewardTransaction)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(account1.address, lpToken.address, expectedAccount1Rewards);

    // ClaimReward for Acc2 done 2 blocks after adding stake
    // 2 block with 20% participation = 0.2 reward tokens * 2 block
    // Account 2 Total = 0.4 reward tokens
    const expectedAccount2Rewards = ethers.utils.parseEther("0.4");
    await expect(acc2ClaimRewardTransaction)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(account2.address, lpToken.address, expectedAccount2Rewards);

    const account2WithdrawTransaction = await lpRewardPoolManager
      .connect(account2)
      .unstake(lpToken.address, amount2);

    await expect(account2WithdrawTransaction)
      .to.emit(lpRewardPoolManager, "StakeWithdrawn")
      .withArgs(account2.address, lpToken.address, amount2);

    const acc1ClaimRewardTransactionAfterAcoount2WithDrawn =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    console.log(
      "acc1ClaimRewardTransactionAfterAcoount2WithDrawn:Blocknumber",
      acc1ClaimRewardTransactionAfterAcoount2WithDrawn.blockNumber
    );
    const expectedAccount1RewardsAfterAcoount2WithDrawn = ethers.utils.parseEther("2.6");
    await expect(acc1ClaimRewardTransactionAfterAcoount2WithDrawn)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1RewardsAfterAcoount2WithDrawn
      );

    // Claiming Reward After a clean block when account2 stake amount is update
    // Expect Reward to be 1 since its being harvested after 1 block
    const acc1ClaimRewardTransactionAfterAcoount2WithDrawn2 =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    console.log(
      "acc1ClaimRewardTransactionAfterAcoount2WithDrawn2:Blocknumber",
      acc1ClaimRewardTransactionAfterAcoount2WithDrawn2.blockNumber
    );
    const expectedAccount1RewardsAfterAcoount2WithDrawn2 = ethers.utils.parseEther("1");
    await expect(acc1ClaimRewardTransactionAfterAcoount2WithDrawn2)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1RewardsAfterAcoount2WithDrawn2.toString()
      );

    // Claiming Reward After a clean block when account2 stake amount is update
    // Expect Reward to be 1 since its being harvested after 1 block
    const acc1ClaimRewardTransactionAfterAcoount2WithDrawn3 =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    console.log(
      "acc1ClaimRewardTransactionAfterAcoount2WithDrawn3:Blocknumber",
      acc1ClaimRewardTransactionAfterAcoount2WithDrawn3.blockNumber
    );
    const expectedAccount1RewardsAfterAcoount2WithDrawn3 = ethers.utils.parseEther("1");
    await expect(acc1ClaimRewardTransactionAfterAcoount2WithDrawn3)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1RewardsAfterAcoount2WithDrawn3
      );

    const account1Amount2 = ethers.utils.parseEther("60");

    const account1WithdrawTransaction = await lpRewardPoolManager
      .connect(account1)
      .unstake(lpToken.address, account1Amount2);

    await expect(account1WithdrawTransaction)
      .to.emit(lpRewardPoolManager, "StakeWithdrawn")
      .withArgs(account1.address, lpToken.address, account1Amount2);

    // Claiming Reward After a clean block when account2 stake amount is update
    // Expect Reward to be 1 since its being harvested after 1 block
    const acc1ClaimRewardTransactionAfterAcoount2WithDrawn4 =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    console.log(
      "acc1ClaimRewardTransactionAfterAcoount2WithDrawn2:Blocknumber",
      acc1ClaimRewardTransactionAfterAcoount2WithDrawn2.blockNumber
    );
    const expectedAccount1RewardsAfterAcoount2WithDrawn4 = ethers.utils.parseEther("1");
    await expect(acc1ClaimRewardTransactionAfterAcoount2WithDrawn4)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1RewardsAfterAcoount2WithDrawn4
      );

    const acc1ClaimRewardTransactionAfterAcoount2WithDrawn5 =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    const expectedAccount1RewardsAfterAcoount2WithDrawn5 = ethers.utils.parseEther("1");
    await expect(acc1ClaimRewardTransactionAfterAcoount2WithDrawn5)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1RewardsAfterAcoount2WithDrawn5
      );

    const amount3 = ethers.utils.parseEther("80");
    // Arrange Account 2 staking
    await stakeToken
      .connect(account3)
      .approve(lpRewardPoolManager.address, amount3);

    await lpRewardPoolManager.connect(account3).stake(lpToken.address, amount3);

    // Act
    // Acc1 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc1ClaimRewardTransactionAfterAccount3Deposit =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    console.log(
      "acc1ClaimRewardTransaction:Blocknumber",
      acc1ClaimRewardTransactionAfterAccount3Deposit.blockNumber
    );

    // Acc2 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc3ClaimRewardTransaction = await lpRewardPoolManager.claimReward(
      lpToken.address,
      account3.address
    );
    console.log(
      "acc3ClaimRewardTransaction:Blocknumber",
      acc3ClaimRewardTransaction.blockNumber
    );

    // Assert
    // 2 blocks with 100% participation = 1 reward tokens * 2 blocks = 2 // ClaimReward for Acc1 done 2 blocks after adding stake
    // 1 block with 80% participation = 0.8 reward tokens * 1 block = 0.8 // 2nd ClaimReward for Acc1 is 80 percent of entire reward
    // Account1 Total = 2 + 0.8 = 2.8 reward tokens
    const expectedAccount1RewardsAfterAccount3Deposit = ethers.utils.parseEther("2.2");
    await expect(acc1ClaimRewardTransactionAfterAccount3Deposit)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1RewardsAfterAccount3Deposit
      );

    // ClaimReward for Acc2 done 2 blocks after adding stake
    // 2 block with 80% participation = 0.8 reward tokens * 2 block
    // Account Total = 1.6 reward tokens
    const expectedAccount3Rewards = ethers.utils.parseEther("1.6");
    await expect(acc3ClaimRewardTransaction)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(account3.address, lpToken.address, expectedAccount3Rewards);

    // Acc2 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc1ClaimRewardTransactionAfterAccount3DepositRound2 =
      await lpRewardPoolManager.claimReward(lpToken.address, account1.address);
    console.log(
      "acc3ClaimRewardTransaction:Blocknumber",
      acc1ClaimRewardTransactionAfterAccount3DepositRound2.blockNumber
    );

    // 2 block with 20% participation = 0.2 reward tokens * 2 block
    // Account Total = 0.4 reward tokens
    const expectedAccount1AfterAccount3DepositRound2 = ethers.utils.parseEther("0.4");
    await expect(acc1ClaimRewardTransactionAfterAccount3DepositRound2)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(
        account1.address,
        lpToken.address,
        expectedAccount1AfterAccount3DepositRound2
      );

    // Acc2 Claim Reward Transaction 2 blocks after Staking in the pool
    const acc3ClaimRewardTransactionRound2 =
      await lpRewardPoolManager.claimReward(lpToken.address, account3.address);
    console.log(
      "acc3ClaimRewardTransaction:Blocknumber",
      acc3ClaimRewardTransactionRound2.blockNumber
    );

    // 2 block with 80% participation = 0.8 reward tokens * 2 block
    // Account Total = 1.6 reward tokens
    const expectedAccount3Rewards2 = ethers.utils.parseEther("1.6");
    await expect(acc3ClaimRewardTransactionRound2)
      .to.emit(lpRewardPoolManager, "RewardClaimed")
      .withArgs(account3.address, lpToken.address, expectedAccount3Rewards2);
  });

  it("Try Staking a token in the first pool without sFIEF minBalance", async function () {
    // Arrange
    const stakeToken = lpToken;
    await createRewardPool(lpRewardPoolManager, lpToken.address, 100);
    const amount = ethers.utils.parseEther("1000");
    await lpToken.approve(lpRewardPoolManager.address, amount);

    await stakeToken.transfer(
      account4.address,
      ethers.utils.parseEther("200000") // 200.000
    );

    const amount2 = ethers.utils.parseEther("200000");

    // Arrange Account 2 staking
    await stakeToken
      .connect(account4)
      .approve(lpRewardPoolManager.address, amount2);

    try {
      // Act
      await lpRewardPoolManager
        .connect(account4)
        .stake(lpToken.address, amount2);
      assert.fail("The transaction should have thrown an error");
    } catch (err) {
      assert.include(err.message, "revert", "Not enough SFIEIF Balance");
    }
  });
});
