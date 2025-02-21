import { config } from "dotenv";
import { ethers } from "ethers";
import { db } from "../firebase.js";
import { getCoinsData } from "../utils/coinsData.js";
import { getCoinSymbolByChainId } from "../utils/getCoinSymbol.js";
import { providers } from "../utils/providers.js";
config();

const mnemonic = process.env.HD_WALLET_PHRASE;
const CENTRAL_WALLET = "0x41DF1029A8637900D3171Ea0Fb177720FA5ce049";
const GAS_LIMIT = 21000;
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
    // Validate the request
    if (!txs || !Array.isArray(txs) || txs.length === 0) {
        console.warn("Invalid transaction data received");
        console.log('webhook received:', req.body)
        return res.status(400).json({ message: "Invalid transaction data received" });
    }

    const tx = txs[0];
    const { hash, toAddress, value, fromAddress } = tx;

    if (!hash || !toAddress || !value || value === "0") {
        console.warn("Invalid transaction fields in webhook");
        console.log('webhook received:', req.body);
        return res.status(400).json({ message: "Invalid transaction fields" });
    }

    try {
        const transactionsRef = db.collection("Transactions").doc(hash);
        const transactionDoc = await transactionsRef.get();
        const usersRef = db.collection("Users");

        // Find user by toAddress
        const userQuery = await usersRef.where("wallets.EVM.address", "==", String(toAddress).toLowerCase()).get();
        if (userQuery.empty) {
            console.log("No user found for toAddress. Ignoring non-deposit transaction:", toAddress);
            return res.status(200).json({ message: "Transaction is not an incoming deposit. Ignored." });
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
        console.log(`  Amount: ${amountEther} ${getCoinSymbolByChainId(chainId)}`);
        console.log(`  Amount (USD): ${usdValue}`);
        console.log(`  Amount (NGN): ${amountNGN}`);
        console.log(`  Address: ${toAddress}`);

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
                    coinSymbol: getCoinSymbolByChainId(chainId),
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
            const privateKey = getWalletPrivateKey(walletIndex);
            const coinSymbol = getCoinSymbolByChainId(chainId);
            const myProvider = providers.find((coin) => coin.name === coinSymbol);
            const provider = new ethers.JsonRpcProvider(myProvider.url.main);
            const wallet = new ethers.Wallet(privateKey, provider);
            const walletBalance = await provider.getBalance(wallet.address);

// Fetch current fee data
const feeData = await provider.getFeeData();
if (!feeData.gasPrice) {
    throw new Error("Failed to retrieve gas price from provider.");
}

// Convert gas price from Wei to Gwei
const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, "gwei"));
const mediumFeeGwei = gasPriceGwei + gasPriceGwei / 2; // 1.5x the base fee
const mediumFeeInWei = ethers.parseUnits(mediumFeeGwei.toFixed(9), "gwei"); // Convert Gwei back to Wei

console.log(`Gas Prices: Low=${gasPriceGwei} Gwei, Medium=${mediumFeeGwei} Gwei`);

// Estimate the required gas limit
const estimatedGasLimit = await provider.estimateGas({
    to: CENTRAL_WALLET,
    value: walletBalance, // Provide max balance for estimation
});
console.log(`Estimated Gas Limit: ${estimatedGasLimit}`);

// Calculate the gas cost
const gasCost = BigInt(estimatedGasLimit.toString()) * BigInt(mediumFeeInWei.toString());

// Calculate a percentage-based buffer (e.g., 5% of the wallet balance)
const bufferPercentage = 0.01; // 1% buffer
const walletBalanceBigInt = BigInt(walletBalance.toString());
const bufferInWei = BigInt(walletBalanceBigInt * BigInt(Math.floor(bufferPercentage * 100)) / 100n);

// Calculate the transferable amount (wallet balance - gas cost - buffer)
const transferableAmount = walletBalanceBigInt - gasCost - bufferInWei;

if (transferableAmount <= 0n) {
    throw new Error(
        `Insufficient balance after reserving gas and buffer. Wallet Balance: ${ethers.formatEther(walletBalance)}, Gas Cost: ${ethers.formatEther(
            gasCost
        )}, Buffer: ${ethers.formatEther(bufferInWei)}`
    );
}

console.log(`Transferable Amount (after buffer): ${ethers.formatEther(transferableAmount)} ETH`);

// Create and send the transaction
try {
    const tx = await wallet.sendTransaction({
        to: CENTRAL_WALLET,
        value: transferableAmount, // Send the remaining balance minus gas cost and buffer
        gasLimit: estimatedGasLimit,
        gasPrice: mediumFeeInWei,
    });

    console.log("Transaction Sent:", tx.hash);

    // Wait for the transaction confirmation
    const receipt = await tx.wait();
    console.log("Transaction Confirmed:", receipt.transactionHash);
} catch (error) {
    console.error("Error sending transaction:", error.message);

    if (error.code === "INSUFFICIENT_FUNDS") {
        console.error(
            `Insufficient funds error. Wallet Balance: ${ethers.formatEther(walletBalance)}, Total Gas Cost: ${ethers.formatEther(
                gasCost
            )}, Buffer: ${ethers.formatEther(bufferInWei)}`
        );
    }
}



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
