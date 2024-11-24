import { Connection, PublicKey } from "@solana/web3.js";
import path from "path";
import dotenv from "dotenv";
import { processTransaction } from "./tx-handler";
import { TokenMetadata } from "./token-utils";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

const TARGET_WALLET = process.env.TARGET_WALLET || "";
const RPC_URL = process.env.RPC_URL || "";
const WSS_URL = process.env.WSS_URL || "";

if (!TARGET_WALLET || !RPC_URL || !WSS_URL) {
  console.error(
    "Error: TARGET_WALLET or RPC_URL or WSS_URL is not defined in the .env file."
  );
  process.exit(1);
}

const connection = new Connection(RPC_URL, { wsEndpoint: WSS_URL });

let tokenMetadataCache: Map<string, TokenMetadata> = new Map();

/**
 * Utility function to introduce a delay.
 * @param ms - The delay duration in milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Monitor transactions for the target wallet.
 */
async function monitorTransactions(): Promise<void> {
  const targetWallet = new PublicKey(TARGET_WALLET);
  console.log(`Monitoring wallet: ${TARGET_WALLET}`);

  connection.onLogs(
    targetWallet,
    async (logs) => {
      console.log(`New transaction detected: ${logs.signature}`);
      await processTransaction(
        logs.signature,
        connection,
        TARGET_WALLET,
        tokenMetadataCache
      );
    },
    "confirmed"
  );
}
// Start monitoring transactions
monitorTransactions().catch((error) => {
  console.error("Error starting transaction monitor:", error);
});
