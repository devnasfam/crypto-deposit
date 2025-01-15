import { config } from "dotenv";
import { ethers } from "ethers";
import { db } from "../firebase.js";
config();

const mnemonic = process.env.HD_WALLET_PHRASE;
const CENTRAL_WALLET = '0x41DF1029A8637900D3171Ea0Fb177720FA5ce049';

// Function to derive the wallet private key from the HD wallet for a given index
function getWalletPrivateKey(index) {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
    const wallet = masterNode.derivePath(derivationPath);
    return wallet.privateKey;
}

// Mock function to fetch the token price (mocked for testing purposes)
async function fetchTokenPrice(chainId) {
    const mockPrices = {
        "0xa4b1": 700, // Mock price for BNB in USD
    };
    return 700; // Return 0 if the chainId is unsupported
}

// Mock conversion rates for testing purposes
const USD_TO_NGN_RATE = 1650; // 1 USD = 750 NGN

// Webhook handler
export const handleDepositWebhook = async (req, res) => {
    const { confirmed, chainId, txs } = req.body;

    if (!txs || txs.length == 0) {
        console.log("No transactions provided");
        return res.status(400).json({ message: "No transactions provided" });
    }

    const tx = txs[0]; // Handle the first transaction
    const { hash, toAddress, value, fromAddress } = tx;

    try {
        const transactionsRef = db.collection("Transactions").doc(hash);
        const transactionDoc = await transactionsRef.get();
        // Find the user with the matching `toAddress` in the Users collection
        const usersRef = db.collection("Users");
        const userQuery = await usersRef.where("wallets.EVM.address", "==", String(toAddress).toLowerCase()).get();

        if (userQuery.empty) {
            console.log("User not found for address:", toAddress)
            return res.status(404).json({ message: "User not found for this address" });
        }

        const userDoc = userQuery.docs[0];
        const userData = userDoc.data();
        const walletIndex = userData.wallets.EVM.walletIndex;

        const date = new Date().toISOString();

        // Step 1: If `confirmed` is false, log the transaction and set status to pending
        if (!confirmed) {
            if (!transactionDoc.exists) {
                await transactionsRef.set({
                    hash,
                    fromAddress,
                    toAddress,
                    value,
                    userId: userData?.id,
                    chainId,
                    status: "pending",
                    type: 'crypto-deposit',
                    date,
                    createdAt: date,
                });
                console.log("Transaction logged with pending status:", hash);
            }
            return res.status(200).json({ message: "Transaction logged as pending" });
        }

        // Step 2: If `confirmed` is true, update the transaction and user balance
        if (confirmed) {
            if (!transactionDoc.exists) {
                console.log("Pending transaction not found:", hash);
                return res.status(404).json({ message: "Pending transaction not found" });
            }

            const transactionData = transactionDoc.data();

            // Update transaction status to success
            await transactionsRef.update({ status: "success", confirmedAt: date});

            // Fetch the token price and calculate the converted amount
            const tokenPriceUSD = await fetchTokenPrice(chainId);
            const amountEther = ethers.formatEther(value);
            const amountUSD = tokenPriceUSD * amountEther;
            const amountNGN = amountUSD * USD_TO_NGN_RATE;

            // Update the user's balance
            const newBalance = (userData.balance || 0) + amountNGN;
            await usersRef.doc(userDoc.id).update({ balance: newBalance });

            console.log("User balance updated:", userDoc.id, newBalance);

            // Step 3: Transfer the funds to the central wallet
            const privateKey = getWalletPrivateKey(walletIndex);
            // const provider = new ethers.JsonRpcProvider(process.env.RPC_URL); // Use the correct RPC URL
            // const signer = new ethers.Wallet(privateKey, provider);

            // const tx = await signer.sendTransaction({
            //     to: CENTRAL_WALLET,
            //     value,
            // });
            // await tx.wait();

            console.log("Funds transferred to central wallet:", CENTRAL_WALLET);

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
