export const getCoinSymbolByChainId = (chainId) => {
    const chainIdToSymbolMap = {
        "0x1": "ETH",          // Ethereum
        "0x38": "BNB",         // Binance Smart Chain
        "0x2105": "BASE_ETH",  // Base Ethereum
        "0xa4b1": "ARB_ETH",   // Arbitrum
        "0xe708": "LINEA_ETH", // Linea Ethereum
        "0x13e31": "BLAST_ETH",// Blast Ethereum
        "0xa86a": "AVAX",      // Avalanche
        "0x45c": "CORE",       // Core
        "0x89": "MATIC"        // Polygon
    };
    return chainIdToSymbolMap[chainId] || "Unknown";
}