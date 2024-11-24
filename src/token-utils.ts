import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";

// Metaplex Token Metadata Program ID
export const METAPLEX_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

export type TokenMetadata = {
  name: string;
  symbol: string;
  decimals: number;
};

/**
 * Fetch token name and decimals using Metaplex metadata.
 */
export async function fetchTokenNameAndDecimals(
  connection: Connection,
  mintAddress: string,
  tokenMetadataCache: Map<string, TokenMetadata>
): Promise<TokenMetadata> {
  if (tokenMetadataCache.has(mintAddress)) {
    return tokenMetadataCache.get(mintAddress)!;
  }

  try {
    const mintPublicKey = new PublicKey(mintAddress);
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
      const decimals = await fetchMintDecimals(connection, mintPublicKey);

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

  return { name: "Unknown", symbol: "UNKNOWN", decimals: 0 };
}

/**
 * Decode Metaplex metadata account data.
 */
function decodeMetaplexMetadata(data: Buffer): {
  name: string;
  symbol: string;
} {
  let offset = 1 + 32 + 32;

  const nameLength = data.readUInt32LE(offset);
  offset += 4;
  const name = data
    .slice(offset, offset + nameLength)
    .toString("utf8")
    .replace(/\0/g, "");
  offset += nameLength;

  const symbolLength = data.readUInt32LE(offset);
  offset += 4;
  const symbol = data
    .slice(offset, offset + symbolLength)
    .toString("utf8")
    .replace(/\0/g, "");

  return { name, symbol };
}

/**
 * Fetch token decimals from the mint account.
 */
async function fetchMintDecimals(
  connection: Connection,
  mintPublicKey: PublicKey
): Promise<number> {
  const accountInfo = await connection.getAccountInfo(mintPublicKey);
  if (accountInfo?.data) {
    return accountInfo.data.readUInt8(44);
  }
  return 0;
}

/**
 * Fetch token price using Dexscreener API.
 * @param tokenAddress - The token's address.
 * @returns The USD price of the token, or null if not found.
 */
export async function fetchTokenPriceFromDexscreener(
  tokenAddress: string
): Promise<number | null> {
  try {
    // API endpoint
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;

    // Make the GET request
    const response = await axios.get(url);

    // Parse the response
    const data = response.data;

    if (data?.pairs?.length > 0) {
      // Extract the price from the first pair
      const priceUsd = parseFloat(data.pairs[0]?.priceUsd);
      return priceUsd || null;
    } else {
      console.error("No pairs found for the token address:", tokenAddress);
      return null;
    }
  } catch (error) {
    console.error("Error fetching token price from Dexscreener:", error);
    return null;
  }
}
