import { Connection, ParsedTransactionWithMeta } from "@solana/web3.js";
import { TokenMetadata, fetchTokenNameAndDecimals } from "./token-utils";

/**
 * Process a transaction to determine balance changes and fetch token metadata dynamically.
 * @param tx - The parsed transaction.
 */
export async function processTransactionForTrades(
  tx: ParsedTransactionWithMeta,
  connection: Connection,
  targetWallet: string,
  tokenMetadataCache: Map<string, TokenMetadata>
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

    if (postToken.owner !== targetWallet) {
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
    const { name, symbol, decimals } = await fetchTokenNameAndDecimals(
      connection,
      mint,
      tokenMetadataCache
    );
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
export async function processTransaction(
  signature: string,
  connection: Connection,
  targetWallet: string,
  tokenMetadataCache: Map<string, TokenMetadata>
): Promise<void> {
  const tx = await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    console.error("Transaction not found:", signature);
    return;
  }

  await processTransactionForTrades(
    tx,
    connection,
    targetWallet,
    tokenMetadataCache
  );
}
