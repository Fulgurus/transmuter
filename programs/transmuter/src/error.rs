use crate::*;

#[error]
pub enum ErrorCode {
    #[msg("Token index must be one of 1,2,3")]
    InvalidTokenIndex, //0

    #[msg("Bank account passed != bank account in config")]
    BankDoesNotMatch,

    #[msg("Mint account passed != mint account in config")]
    MintDoesNotMatch,

    #[msg("Minted mutations require a Candy Machine ID to be present")]
    CandyMachineMissing,

    #[msg("Arithmetic error (likely under/overflow)")]
    ArithmeticError,

    #[msg("This mutation has exhausted all of its uses")]
    NoMoreUsesLeft, //5

    #[msg("Funding amount doesn't added up to uses * amount per use")]
    IncorrectFunding,

    #[msg("This taker's vault doesn't have enough gems")]
    InsufficientVaultGems,

    #[msg("This taker's vault doesn't have enough rarity points")]
    InsufficientVaultRarityPoints,

    #[msg("Passed vault doesn't belong to passed bank")]
    VaultDoesNotBelongToBank,

    #[msg("Mutation hasn't completed yet - need more time")]
    MutationNotComplete, //10

    #[msg("Reversals & abortions require all vaults to be set to Lock")]
    VaultsNotSetToLock,

    #[msg("Abortion time specified muse be <= mutation time")]
    AbortTimeTooLarge,

    #[msg("Abortion window has closed")]
    AbortWindowClosed,

    #[msg("Ths mutation doesn't support aborts")]
    AbortNotSupported,

    #[msg("Execution Receipt account not initialized, means you're calling 1st time")]
    ExecutionReceiptMissing, //15
}
