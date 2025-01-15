import fetch from "node-fetch";
import { db } from "../firebase.js";

export const getCoinsData = async () => {
    try {
        // Fetch data from Coinlore API
        const response = await fetch('https://api.coinlore.net/api/tickers/');
        const json = await response.json();

        // List of coins you want to fetch from Firestore
        const coinsToFetch = ['BNB', 'SOL', 'TON', 'EGLD', 'CORE', 'MATIC', 'ETH'];

        // Loop through each coin and fetch its data from Firestore
        const promises = coinsToFetch.map(async (coinSymbol) => {
            const coinPricesRef = db.collection("coinPrices").doc(coinSymbol);
            const coinPricesDoc = await coinPricesRef.get();

            if (!coinPricesDoc.exists) {
                // console.log(`${coinSymbol} data not found in Firestore`);
                return;
            }

            const coinData = coinPricesDoc.data()?.prices;  // Assuming prices is an object with price and percentage
            if (coinData) {
                // Construct the coin object
                const coin = {
                    symbol: coinSymbol,
                    name: coinData?.name || coinSymbol,  // Set name or fallback to symbol
                    price_usd: coinData?.price || "Unavailable",
                    percent_change_24h: coinData?.percentage || "Unavailable",
                    market_cap_usd: "Unavailable",  // You can dynamically fetch if available
                    volume24: "Unavailable",
                    csupply: "Unavailable",
                    tsupply: "Unavailable",
                    msupply: "Unavailable",
                };

                // Check if the coin exists in the Coinlore data, and replace or add it
                const existingCoinIndex = json.data.findIndex(coin => coin.symbol === coinSymbol);

                if (existingCoinIndex > -1) {
                    // Replace the existing coin with the new data from Firestore
                    json.data[existingCoinIndex] = coin;
                    // console.log(`Replaced existing coin data for ${coinSymbol}`);
                } else {
                    // If the coin doesn't exist in Coinlore data, add it
                    json.data.push(coin);
                    // console.log(`Added new coin data for ${coinSymbol}`);
                }
            } else {
                console.log(`No price data found for ${coinSymbol} in Firestore.`);
            }
        });

        // Wait for all Firestore data fetches to complete
        await Promise.all(promises);

        // Log the final fetched data for debugging
        // console.log("Final fetched data:", json.data);

        return json.data;

    } catch (error) {
        console.log('Error fetching data:', error);
        return { error: error.message };
    }
};
