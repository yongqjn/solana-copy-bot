import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import path from "path";
import dotenv from "dotenv";

// Add debugging to see what's happening
const result = dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

if (result.error) {
  console.error("Error loading .env file:", result.error);
}

const TARGET_WALLET = process.env.TARGET_WALLET || "";
const RPC_URL = process.env.RPC_URL || "";
const WSS_URL = process.env.WSS_URL || "";

if (!TARGET_WALLET || !RPC_URL || !WSS_URL) {
  console.error(
    "Error: TARGET_WALLET or RPC_URL or WSS_URL is not defined in the .env file."
  );
  process.exit(1);
}

// Metaplex Token Metadata Program ID
const METAPLEX_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const connection = new Connection(RPC_URL, { wsEndpoint: WSS_URL });

// Cache for token metadata
let tokenMetadataCache: Map<
  string,
  { name: string; symbol: string; decimals: number }
> = new Map();

/**
 * Utility function to introduce a delay.
 * @param ms - The delay duration in milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch token name and decimals using Metaplex metadata.
 * @param mintAddress - The mint address of the token.
 * @returns Token name, symbol, and decimals.
 */
async function fetchTokenNameAndDecimals(
  mintAddress: string
): Promise<{ name: string; symbol: string; decimals: number }> {
  if (tokenMetadataCache.has(mintAddress)) {
    return tokenMetadataCache.get(mintAddress)!;
  }

  try {
    const mintPublicKey = new PublicKey(mintAddress);

    // Derive PDA for Metaplex metadata
    const metadataPDA = (
      await PublicKey.findProgramAddress(
        [
          Buffer.from("metadata"),
          METAPLEX_METADATA_PROGRAM.toBuffer(),
          mintPublicKey.toBuffer(),
        ],
        METAPLEX_METADATA_PROGRAM
      )
    )[0];

    const accountInfo = await connection.getAccountInfo(metadataPDA);

    if (accountInfo?.data) {
      const metadata = decodeMetaplexMetadata(accountInfo.data);
      const decimals = await fetchMintDecimals(mintPublicKey);

      // Cache the metadata
      const tokenData = {
        name: metadata.name.trim(),
        symbol: metadata.symbol.trim(),
        decimals,
      };
      tokenMetadataCache.set(mintAddress, tokenData);

      return tokenData;
    }
  } catch (error) {
    console.error(
      `Error fetching Metaplex metadata for token: ${mintAddress}`,
      error
    );
  }

  // Fallback if metadata is unavailable
  return { name: "Unknown", symbol: "UNKNOWN", decimals: 0 };
}

/**
 * Decode Metaplex metadata account data.
 * @param data - Raw metadata account data.
 * @returns Decoded metadata fields.
 */
function decodeMetaplexMetadata(data: Buffer): {
  name: string;
  symbol: string;
} {
  let offset = 1 + 32 + 32; // Discriminator + updateAuthority + mint

  // Decode the name
  const nameLength = data.readUInt32LE(offset); // Read the length of the name
  offset += 4; // Move past the length field
  const name = data
    .slice(offset, offset + nameLength)
    .toString("utf8")
    .replace(/\0/g, "");
  offset += nameLength; // Move past the name field

  // Decode the symbol
  const symbolLength = data.readUInt32LE(offset); // Read the length of the symbol
  offset += 4; // Move past the length field
  const symbol = data
    .slice(offset, offset + symbolLength)
    .toString("utf8")
    .replace(/\0/g, "");

  return { name, symbol };
}

/**
 * Fetch token decimals from the mint account.
 * @param mintPublicKey - The mint public key.
 * @returns Decimals for the token.
 */
async function fetchMintDecimals(mintPublicKey: PublicKey): Promise<number> {
  const accountInfo = await connection.getAccountInfo(mintPublicKey);
  if (accountInfo?.data) {
    return accountInfo.data.readUInt8(44); // Decimals are at byte offset 44
  }
  return 0; // Default to 0 if unavailable
}

/**
 * Process a transaction to determine balance changes and fetch token metadata dynamically.
 * @param tx - The parsed transaction.
 */
async function processTransactionForTrades(
  tx: ParsedTransactionWithMeta
): Promise<void> {
  if (!tx.meta) {
    console.error("Transaction meta not available.");
    return;
  }

  console.log("Processing transaction for trades...");

  // Process native SOL balance changes
  const preSolBalance = tx.meta.preBalances[0] / 1e9; // Convert from lamports to SOL
  const postSolBalance = tx.meta.postBalances[0] / 1e9; // Convert from lamports to SOL
  const solBalanceChange = postSolBalance - preSolBalance;

  if (solBalanceChange !== 0) {
    const action = solBalanceChange > 0 ? "Bought" : "Sold";
    console.log(
      `Token: SOL, ${action}: ${Math.abs(solBalanceChange).toFixed(9)} SOL`
    );
  }

  // Aggregate changes for SPL tokens
  const tokenChanges: Map<string, { change: number; mint: string }> = new Map();
  const preTokenBalances = tx.meta.preTokenBalances || [];
  const postTokenBalances = tx.meta.postTokenBalances || [];

  for (const postToken of postTokenBalances) {
    const tokenAccountIndex = postToken.accountIndex;
    const mint = postToken.mint;

    if (postToken.owner !== TARGET_WALLET) {
      continue; // Skip if the owner is not the tracked wallet
    }

    const preBalanceEntry = preTokenBalances.find(
      (preBalance) => preBalance.accountIndex === tokenAccountIndex
    );

    const preBalance = preBalanceEntry?.uiTokenAmount.uiAmount || 0;
    const postBalance = postToken.uiTokenAmount.uiAmount || 0;
    const balanceChange = postBalance - preBalance;

    if (balanceChange !== 0) {
      tokenChanges.set(mint, { change: balanceChange, mint });
    }
  }

  // Log aggregated token changes
  for (const [mint, { change }] of tokenChanges.entries()) {
    const { name, symbol, decimals } = await fetchTokenNameAndDecimals(mint);
    const action = change > 0 ? "Bought" : "Sold";
    console.log(
      `Token: ${name} (${mint}), ${action}: ${Math.abs(change).toFixed(
        decimals
      )} ${symbol}`
    );
  }

  console.log("\n");
}

/**
 * Process a transaction to check for balance changes and token metadata.
 * @param signature - The transaction signature.
 */
async function processTransaction(signature: string): Promise<void> {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    console.error("Transaction not found:", signature);
    return;
  }

  await processTransactionForTrades(tx);
}

/**
 * Monitor transactions for the target wallet.
 */
async function monitorTransactions(): Promise<void> {
  const targetWallet = new PublicKey(TARGET_WALLET);
  console.log(`Monitoring wallet: ${TARGET_WALLET}`);

  // await processTransaction("5zF2BrWiP184pTT7CwevRyhsEnFdJLMEDKEpfnWKsNtCWS7mY37rGVoHBG1H4MKaTfutN1wZZE3Gg2A7iLdvy3JS")

  connection.onLogs(
    targetWallet,
    async (logs) => {
      console.log(`New transaction detected: ${logs.signature}`);
      await processTransaction(logs.signature);
    },
    "confirmed"
  );
}

// Start monitoring transactions
monitorTransactions().catch((error) => {
  console.error("Error starting transaction monitor:", error);
});
