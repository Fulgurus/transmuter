import { PublicKey } from "@solana/web3.js";
import { GEM_BANK_PROG_ID } from "@gemworks/gem-farm-ts";
import { TRANSMUTER_ADDRESSES } from "./constants";

//todo fix bank/farm PDAs as well

export const findTransmuterAuthorityPDA = async (
  transmuter: PublicKey
): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [transmuter.toBytes()],
    TRANSMUTER_ADDRESSES.Transmuter
  );
};

export const findTokenEscrowPDA = async (
  mutation: PublicKey,
  mint: PublicKey
): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [Buffer.from("escrow"), mutation.toBytes(), mint.toBytes()],
    TRANSMUTER_ADDRESSES.Transmuter
  );
};

export const findVaultCreatorPDA = async (
  mutation: PublicKey,
  taker: PublicKey
): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [Buffer.from("creator"), mutation.toBytes(), taker.toBytes()],
    TRANSMUTER_ADDRESSES.Transmuter
  );
};

export const findTakerVaultPDA = async (
  bank: PublicKey,
  mutation: PublicKey,
  taker: PublicKey
) => {
  const [creator, creatorBump] = await findVaultCreatorPDA(mutation, taker);
  const [vault, vaultBump] = await PublicKey.findProgramAddress(
    [Buffer.from("vault"), bank.toBytes(), creator.toBytes()],
    GEM_BANK_PROG_ID
  );
  return { creator, creatorBump, vault, vaultBump };
};

export const findWhitelistProofPDA = async (
  bank: PublicKey,
  whitelistedAddress: PublicKey
): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [Buffer.from("whitelist"), bank.toBytes(), whitelistedAddress.toBytes()],
    GEM_BANK_PROG_ID
  );
};

export const findRarityPDA = async (
  bank: PublicKey,
  mint: PublicKey
): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [Buffer.from("gem_rarity"), bank.toBytes(), mint.toBytes()],
    GEM_BANK_PROG_ID
  );
};

export const findExecutionReceiptPDA = async (
  mutation: PublicKey,
  taker: PublicKey
): Promise<[PublicKey, number]> => {
  return PublicKey.findProgramAddress(
    [Buffer.from("receipt"), mutation.toBytes(), taker.toBytes()],
    TRANSMUTER_ADDRESSES.Transmuter
  );
};
