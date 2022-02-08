import {
  AugmentedProvider,
  Provider,
  SolanaAugmentedProvider,
  TransactionEnvelope,
} from "@saberhq/solana-contrib";
import { Programs, TRANSMUTER_ADDRESSES, TRANSMUTER_IDLS } from "./constants";
import { newProgramMap } from "@saberhq/anchor-contrib";
import { MutationWrapper } from "./wrappers";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { BN } from "@project-serum/anchor";
import { GEM_BANK_PROG_ID, stringifyPKsAndBNs } from "@gemworks/gem-farm-ts";
import {
  createMint,
  getATAAddress,
  getOrCreateATA,
  Token,
  TokenAmount,
  TokenOwner,
} from "@saberhq/token-utils";
import { TOKEN_PROGRAM_ID, u64 } from "@solana/spl-token";

export interface InTokenConfig {
  gemBank: PublicKey;
  amount: BN;
  action: any; //SinkAction
  destination: PublicKey | null;
}

export const OutTokenSource = {
  Mint: { mint: {} },
  Prefunded: { prefunded: {} },
};

export interface OutTokenConfig {
  source: any; //OutTokenSource
  amount: BN;
  candyMachine: PublicKey | null;
  mint: PublicKey | null;
}

export const SinkAction = {
  Burn: { burn: {} },
  Transfer: { transfer: {} },
  Preserve: { preserve: {} },
};

export interface TimeSettings {
  mutationTimeSec: BN;
  cancelWindowSec: BN;
}

export interface MutationConfig {
  inTokenA: InTokenConfig;
  inTokenB: InTokenConfig | null;
  inTokenC: InTokenConfig | null;

  outTokenA: OutTokenConfig;
  outTokenB: OutTokenConfig | null;
  outTokenC: OutTokenConfig | null;

  timeSettings: TimeSettings;

  price: BN;

  payEveryTime: boolean;

  updateMetadata: boolean;

  reversible: boolean;
}

export class TransmuterSDK {
  constructor(
    readonly provider: AugmentedProvider,
    readonly programs: Programs
  ) {}

  // --------------------------------------- pda derivations

  async findMutationAuthorityPDA(
    mutation: PublicKey
  ): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddress(
      [mutation.toBytes()],
      this.programs.Transmuter.programId
    );
  }

  async findTokenEscrowPDA(
    mutation: PublicKey,
    mint: PublicKey
  ): Promise<[PublicKey, number]> {
    return PublicKey.findProgramAddress(
      [Buffer.from("escrow"), mutation.toBytes(), mint.toBytes()],
      this.programs.Transmuter.programId
    );
  }

  // --------------------------------------- initializers

  async initMutation(
    config: MutationConfig,
    mutation: PublicKey,
    payer?: PublicKey
  ) {
    // ----------------- prep banks
    const bankA = config.inTokenA.gemBank;
    let bankB: PublicKey;
    let bankC: PublicKey;

    const signers: Keypair[] = [];

    if (config.inTokenB) {
      bankB = config.inTokenB.gemBank;
    } else {
      const fakeBankB = Keypair.generate();
      bankB = fakeBankB.publicKey;
      signers.push(fakeBankB);
    }

    if (config.inTokenC) {
      bankC = config.inTokenC.gemBank;
    } else {
      const fakeBankC = Keypair.generate();
      bankC = fakeBankC.publicKey;
      signers.push(fakeBankC);
    }

    // ----------------- prep escrows

    //todo CM logic

    const tokenAMint =
      config.outTokenA.mint ?? (await createMint(this.provider));
    const [tokenAEscrow, tokenAEscrowBump, tokenASource] =
      await this.prepTokenAccs(mutation, tokenAMint);

    const tokenBMint =
      config.outTokenB && config.outTokenB.mint
        ? config.outTokenB.mint
        : await createMint(this.provider);
    const [tokenBEscrow, tokenBEscrowBump, tokenBSource] =
      await this.prepTokenAccs(mutation, tokenBMint);

    const tokenCMint =
      config.outTokenC && config.outTokenC.mint
        ? config.outTokenC.mint
        : await createMint(this.provider);
    const [tokenCEscrow, tokenCEscrowBump, tokenCSource] =
      await this.prepTokenAccs(mutation, tokenCMint);

    // ----------------- prep ix

    const [authority, bump] = await this.findMutationAuthorityPDA(mutation);

    const ix = this.programs.Transmuter.instruction.initMutation(
      bump,
      tokenAEscrowBump,
      tokenBEscrowBump,
      tokenCEscrowBump,
      config as any,
      {
        accounts: {
          mutation,
          owner: this.provider.wallet.publicKey,
          authority,
          bankA,
          bankB,
          bankC,
          gemBank: GEM_BANK_PROG_ID,
          tokenAEscrow,
          tokenASource,
          tokenAMint,
          tokenBEscrow,
          tokenBSource,
          tokenBMint,
          tokenCEscrow,
          tokenCSource,
          tokenCMint,
          payer: payer ?? this.provider.wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        },
      }
    );

    return {
      mutationWrapper: new MutationWrapper(this),
      tx: new TransactionEnvelope(this.provider, [ix], signers),
    };
  }

  async prepTokenAccs(mutation: PublicKey, tokenMint: PublicKey) {
    const [tokenEscrow, tokenEscrowBump] = await this.findTokenEscrowPDA(
      mutation,
      tokenMint
    );
    const tokenSource = await getATAAddress({
      mint: tokenMint,
      owner: this.provider.wallet.publicKey,
    });

    return [tokenEscrow, tokenEscrowBump, tokenSource];
  }

  // --------------------------------------- helpers

  async createMintAndATA(initialFunding: u64) {
    //create mint
    const mint = await createMint(this.provider);

    //create ATA ix
    const { address: ata, instruction } = await getOrCreateATA({
      provider: this.provider,
      mint,
    });

    //create mintTo ix
    const token = Token.fromMint(mint, 0);
    const owner = new TokenOwner(this.provider.wallet.publicKey);
    const amount = new TokenAmount(token, initialFunding);
    const mintToIx = owner.mintTo(amount, ata);

    //prep & send tx
    const mintTx = new TransactionEnvelope(this.provider, [
      instruction,
      mintToIx,
    ]);
    await mintTx.confirm();

    return [mint, ata];
  }

  // --------------------------------------- load

  static load({
    provider,
    addresses = TRANSMUTER_ADDRESSES,
  }: {
    provider: Provider;
    addresses?: any; //todo
  }): TransmuterSDK {
    const programs = newProgramMap<Programs>(
      provider,
      TRANSMUTER_IDLS,
      addresses
    );
    return new TransmuterSDK(new SolanaAugmentedProvider(provider), programs);
  }
}
