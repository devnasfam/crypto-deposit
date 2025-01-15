import { config } from "dotenv";
import { ethers } from "ethers";
import { db } from "../firebase.js";
import { getCoinsData } from "../utils/coinsData.js";
import { getCoinSymbolByChainId } from "../utils/getCoinSymbol.js";
config();

const mnemonic = process.env.HD_WALLET_PHRASE;
const CENTRAL_WALLET = "0x41DF1029A8637900D3171Ea0Fb177720FA5ce049";

// Function to derive the wallet private key from the HD wallet for a given index
function getWalletPrivateKey(index) {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
    const wallet = masterNode.derivePath(derivationPath);
    return wallet.privateKey;
}

// Fetch token price from coins data
async function fetchTokenPrice(chainId) {
    try {
        const coinSymbol = getCoinSymbolByChainId(chainId);
        const coinsData = await getCoinsData();
        let coinData = coinsData.find((data) => data.symbol === coinSymbol);

        // Handle special cases for EVM forks
        if (!coinData && ["ARB_ETH", "BASE_ETH", "BLAST_ETH", "LINEA_ETH"].includes(coinSymbol)) {
            coinData = coinsData.find((data) => data.symbol === "ETH");
        }

        if (!coinData) {
            throw new Error(`Coin data not found for chainId ${chainId}`);
        }

        return coinData.price_usd;
    } catch (error) {
        console.error("Error fetching token price:", error.message);
        throw new Error("Failed to fetch token price.");
    }
}

// Webhook handler for deposit processing
export const handleDepositWebhook = async (req, res) => {
    const { confirmed, chainId, txs } = req.body;
    console.log("Webhook received:", req.body);

    if (!txs || txs.length === 0) {
        return res.status(400).json({ message: "No transactions provided" });
    }

    const tx = txs[0];
    const { hash, toAddress, value, fromAddress } = tx;

    try {
        const transactionsRef = db.collection("Transactions").doc(hash);
        const transactionDoc = await transactionsRef.get();
        const usersRef = db.collection("Users");

        // Find user by toAddress
        const userQuery = await usersRef.where("wallets.EVM.address", "==", String(toAddress).toLowerCase()).get();
        if (userQuery.empty) {
            console.warn("User not found for address:", toAddress);
            return res.status(404).json({ message: "User not found for this address" });
        }

        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const walletIndex = userData.wallets.EVM.walletIndex;

        // Fetch token price
        const tokenPriceUSD = await fetchTokenPrice(chainId);
        const usdToNgnRate = (await db.collection("Rates").doc("usdToNgn").get()).data()?.usdDeposit || 1640;

        // Calculate amounts
        const amountEther = ethers.formatEther(value);
        const usdValue = parseFloat(amountEther) * tokenPriceUSD;
        const amountNGN = usdValue * usdToNgnRate;

        console.log("Transaction Details:");
        console.log(`  Amount (ETH): ${amountEther}`);
        console.log(`  Amount (USD): ${usdValue}`);
        console.log(`  Amount (NGN): ${amountNGN}`);

        // Step 1: Handle unconfirmed transactions
        if (!confirmed) {
            if (!transactionDoc.exists) {
                await transactionsRef.set({
                    hash,
                    fromAddress,
                    toAddress,
                    value,
                    userId: userData.id,
                    chainId,
                    amountEther,
                    amountNGN,
                    amountUSD: usdValue,
                    tokenPriceUSD,
                    status: "pending",
                    type: "crypto-deposit",
                    date: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                });
                console.log("Transaction logged as pending:", hash);
            }
            return res.status(200).json({ message: "Transaction logged as pending" });
        }

        // Step 2: Handle confirmed transactions
        if (confirmed) {
            if (!transactionDoc.exists) {
                console.warn("Pending transaction not found:", hash);
                return res.status(404).json({ message: "Pending transaction not found" });
            }

            // Update transaction status to success
            await transactionsRef.update({ status: "success", confirmedAt: new Date().toISOString() });

            // Update user balance
            const newBalance = (userData.balance || 0) + amountNGN;
            await usersRef.doc(userDoc.id).update({ balance: newBalance });
            console.log("User balance updated:", newBalance);

            // // Transfer funds to the central wallet
            // const privateKey = getWalletPrivateKey(walletIndex);
            // const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
            // const signer = new ethers.Wallet(privateKey, provider);

            // const transferTx = await signer.sendTransaction({
            //     to: CENTRAL_WALLET,
            //     value,
            // });
            // await transferTx.wait();
            // console.log("Funds transferred to central wallet:", CENTRAL_WALLET);

            return res.status(200).json({
                message: "Deposit processed successfully",
                transactionHash: hash,
            });
        }
    } catch (error) {
        console.error("Error handling deposit webhook:", error.message);
        res.status(500).json({ message: "Failed to process webhook", error: error.message });
    }
};
