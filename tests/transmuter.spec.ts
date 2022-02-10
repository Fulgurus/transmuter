import { makeSDK } from "./workspace";
import {
  MakerTokenConfig,
  MutationConfig,
  MutationWrapper,
  RequiredUnits,
  TakerTokenConfig,
  TransmuterWrapper,
  VaultAction,
} from "../src";
import { expectTX } from "@saberhq/chai-solana";

import "chai-bn";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  GEM_BANK_PROG_ID,
  GemBankClient,
  pause,
  toBN,
} from "@gemworks/gem-farm-ts";
import { expect } from "chai";
import { BN } from "@project-serum/anchor";
import { getATAAddress } from "@saberhq/token-utils";

describe("transmuter", () => {
  const sdk = makeSDK();

  const bankIdl = require("./programs/gem_bank.json");
  const gb = new GemBankClient(
    sdk.provider.connection,
    sdk.provider.wallet as any,
    bankIdl,
    GEM_BANK_PROG_ID
  );

  const makerTokenAmount = toBN(3);
  const takerTokenAmount = toBN(5);

  let transmuter: TransmuterWrapper;
  let mutation: MutationWrapper;
  let taker: Keypair;

  beforeEach("prep", () => {
    taker = Keypair.generate();
  });

  const prepareTransmuter = async (bankCount: number) => {
    const { transmuterWrapper, tx } = await sdk.initTransmuter(bankCount);
    await expectTX(tx, "init new transmuter").to.be.fulfilled;
    transmuter = transmuterWrapper;

    console.log("transmuter ready");
  };

  const prepareMutation = async ({
    vaultAction = VaultAction.Lock,
    mutationTimeSec = toBN(0),
    takerTokenB = null,
    takerTokenC = null,
    makerTokenB = null,
    makerTokenC = null,
  }: {
    vaultAction?: any;
    mutationTimeSec?: BN;
    takerTokenB?: TakerTokenConfig;
    takerTokenC?: TakerTokenConfig;
    makerTokenB?: MakerTokenConfig;
    makerTokenC?: MakerTokenConfig;
  }) => {
    const [makerMint] = await sdk.createMintAndATA(toBN(makerTokenAmount));

    const config: MutationConfig = {
      takerTokenA: {
        gemBank: transmuter.bankA,
        requiredAmount: toBN(takerTokenAmount),
        requiredUnits: RequiredUnits.RarityPoints,
        vaultAction,
      },
      takerTokenB,
      takerTokenC,
      makerTokenA: {
        mint: makerMint,
        totalFunding: toBN(makerTokenAmount),
        amountPerUse: toBN(makerTokenAmount),
      },
      makerTokenB,
      makerTokenC,
      timeConfig: {
        mutationTimeSec,
        cancelWindowSec: toBN(0),
      },
      priceConfig: {
        price: toBN(0),
        payEveryTime: false,
        paid: false,
      },
      reversible: false,
    };

    const { mutationWrapper, tx } = await sdk.initMutation(
      config,
      transmuter.key,
      toBN(1)
    );
    await expectTX(tx, "init new mutation").to.be.fulfilled;
    mutation = mutationWrapper;

    console.log("mutation ready");

    return { makerMint };
  };

  const prepareTakerVaults = async (bank?: PublicKey) => {
    //fund taker
    await sdk.provider.connection
      .requestAirdrop(taker.publicKey, LAMPORTS_PER_SOL)
      .then((sig) =>
        sdk.provider.connection.confirmTransaction(sig, "confirmed")
      );

    //create vaults
    const { vault } = await gb.initVault(
      bank ?? transmuter.bankA,
      taker,
      taker,
      taker.publicKey,
      "abc"
    );

    //create tokens
    const [takerMint, takerAcc] = await sdk.createMintAndATA(
      toBN(takerTokenAmount),
      taker
    );

    //deposit tokens
    await gb.depositGem(
      bank ?? transmuter.bankA,
      vault,
      taker,
      toBN(takerTokenAmount),
      takerMint,
      takerAcc
    );

    return { vault, takerMint, takerAcc };
  };

  const verifyTakerReceivedTokens = async (
    makerMint: PublicKey,
    amount?: BN
  ) => {
    const makerATA = await getATAAddress({
      mint: makerMint,
      owner: taker.publicKey,
    });
    expect(
      (await sdk.provider.connection.getTokenAccountBalance(makerATA)).value
        .amount
    ).to.eq(amount ? amount.toString() : makerTokenAmount.toString());
  };

  it("happy path (lock vault)", async () => {
    await prepareTransmuter(3); //test 3
    const { makerMint } = await prepareMutation({});
    const { vault, takerMint } = await prepareTakerVaults();

    //call execute
    const tx = await mutation.execute(taker.publicKey);
    tx.addSigners(taker);

    await expectTX(tx, "executes mutation").to.be.fulfilled;

    //verify vault is locked and owned by taker
    const vaultAcc = await gb.fetchVaultAcc(vault);
    expect(vaultAcc.owner.toBase58()).to.be.eq(taker.publicKey.toBase58());
    expect(vaultAcc.locked).to.be.true;

    //verify taker can't withdraw gems
    await expect(
      gb.withdrawGem(
        transmuter.bankA,
        vault,
        taker,
        toBN(takerTokenAmount),
        takerMint,
        Keypair.generate().publicKey
      )
    ).to.be.rejectedWith("0x1784");

    //verify tokens are indeed in taker's wallet
    await verifyTakerReceivedTokens(makerMint);
  });

  it("happy path (change owner)", async () => {
    await prepareTransmuter(1); //test 2
    const { makerMint } = await prepareMutation({
      vaultAction: VaultAction.ChangeOwner,
    });
    const { vault, takerMint } = await prepareTakerVaults();

    //call execute
    const tx = await mutation.execute(taker.publicKey);
    tx.addSigners(taker);

    await expectTX(tx, "executes mutation").to.be.fulfilled;

    //verify vault is unlocked and owned by mutation maker
    const vaultAcc = await gb.fetchVaultAcc(vault);
    expect(vaultAcc.owner.toBase58()).to.be.eq(
      sdk.provider.wallet.publicKey.toBase58()
    );
    expect(vaultAcc.locked).to.be.false;

    //verify mutation maker can withdraw tokens
    await gb.withdrawGem(
      transmuter.bankA,
      vault,
      sdk.provider.wallet.publicKey,
      toBN(takerTokenAmount),
      takerMint,
      Keypair.generate().publicKey
    );

    //verify tokens are indeed in taker's wallet
    await verifyTakerReceivedTokens(makerMint);
  });

  it("happy path (do nothing)", async () => {
    await prepareTransmuter(1); //test 1
    const { makerMint } = await prepareMutation({
      vaultAction: VaultAction.DoNothing,
    });
    const { vault, takerMint } = await prepareTakerVaults();

    //call execute
    const tx = await mutation.execute(taker.publicKey);
    tx.addSigners(taker);

    await expectTX(tx, "executes mutation").to.be.fulfilled;

    //verify vault is unlocked and owned by taker
    const vaultAcc = await gb.fetchVaultAcc(vault);
    expect(vaultAcc.owner.toBase58()).to.be.eq(taker.publicKey.toBase58());
    expect(vaultAcc.locked).to.be.false;

    //verify taker can withdraw tokens
    await gb.withdrawGem(
      transmuter.bankA,
      vault,
      taker,
      toBN(takerTokenAmount),
      takerMint,
      Keypair.generate().publicKey
    );

    //verify tokens are indeed in taker's wallet
    await verifyTakerReceivedTokens(makerMint);
  });

  //using max maker tokens and max taker tokens to test out compute budget
  it.only("happy path (mutation time > 0, 3 maker, 3 taker))", async () => {
    await prepareTransmuter(3);

    const [makerMintB] = await sdk.createMintAndATA(toBN(makerTokenAmount));
    const [makerMintC] = await sdk.createMintAndATA(toBN(makerTokenAmount));
    const { makerMint } = await prepareMutation({
      mutationTimeSec: toBN(5),
      takerTokenB: {
        gemBank: transmuter.bankB,
        requiredAmount: toBN(takerTokenAmount),
        requiredUnits: RequiredUnits.RarityPoints,
        vaultAction: VaultAction.Lock,
      },
      takerTokenC: {
        gemBank: transmuter.bankC,
        requiredAmount: toBN(takerTokenAmount),
        requiredUnits: RequiredUnits.RarityPoints,
        vaultAction: VaultAction.Lock,
      },
      makerTokenB: {
        mint: makerMintB,
        totalFunding: toBN(makerTokenAmount),
        amountPerUse: toBN(makerTokenAmount),
      },
      makerTokenC: {
        mint: makerMintC,
        totalFunding: toBN(makerTokenAmount),
        amountPerUse: toBN(makerTokenAmount),
      },
    });

    const { vault, takerMint } = await prepareTakerVaults(transmuter.bankA);
    await prepareTakerVaults(transmuter.bankB);
    await prepareTakerVaults(transmuter.bankC);

    //call execute
    const tx = await mutation.execute(taker.publicKey);
    tx.addSigners(taker);

    await expectTX(tx, "executes mutation").to.be.fulfilled;

    //verify vault is locked and owned by taker
    const vaultAcc = await gb.fetchVaultAcc(vault);
    expect(vaultAcc.owner.toBase58()).to.be.eq(taker.publicKey.toBase58());
    expect(vaultAcc.locked).to.be.true;

    //verify taker can't withdraw gems
    await expect(
      gb.withdrawGem(
        transmuter.bankA,
        vault,
        taker,
        toBN(takerTokenAmount),
        takerMint,
        Keypair.generate().publicKey
      )
    ).to.be.rejectedWith("0x1784");

    //verify no tokens in taker's wallet after first call
    await verifyTakerReceivedTokens(makerMint, toBN(0));

    //try to call immediately again - will fail, since not enough time passed
    await expect(tx.confirm()).to.be.rejected;

    // todo
    // try {
    //   await tx.confirm();
    // } catch (e) {
    //   expect(e.message).to.include("0x177a");
    // }

    console.log("pausing for mutation duration");
    await pause(5000);

    //call again
    await expectTX(tx, "executes mutation").to.be.fulfilled;

    //this time tokens present
    await verifyTakerReceivedTokens(makerMint);
  });
});
