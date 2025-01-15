import { config } from "dotenv";
import { ethers } from "ethers";
import Moralis from "moralis";
import { db } from "../firebase.js";

config();

const mnemonic = process.env.HD_WALLET_PHRASE;

// Initialize Moralis
await Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
});

// Function to derive a wallet address based on the index
function deriveWallet(index) {
    const derivationPath = `m/44'/60'/0'/0/${index}`; // EVM-compatible path
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
    const wallet = masterNode.derivePath(derivationPath);
    return {
        address: wallet.address,
    };
}

// Function to add an address to a Moralis stream
async function addToMoralisStream(address) {
    try {
        const streamId = process.env.MORALIS_STREAM_ID; 
        const response = await Moralis.Streams.addAddress({
            id: streamId,
            address: [address], // Adding the address to the stream
        });
        console.log("Address added to Moralis stream:", response.toJSON());
    } catch (error) {
        console.error("Error adding address to Moralis stream:", error.message);
        throw new Error("Failed to add address to Moralis stream.");
    }
}

// Function to generate and assign an address to a user for EVM coins
export const generateAddress = async (req, res) => {
    const { userId } = req.body;

    // Validate inputs
    if (!userId) {
        return res.status(400).json({ message: "User ID is required" });
    }

    try {
        const indexRef = db.collection("walletIndex").doc("EVM"); // Shared index for EVM coins
        const userRef = db.collection("Users").doc(userId);

        // Firestore transaction for atomic updates
        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) {
                throw new Error("User not found");
            }

            const userData = userDoc.data();
            const userWallets = userData.wallets || {};

            // Check if an EVM wallet already exists for the user
            if (userWallets["EVM"]) {
                throw new Error("EVM wallet already exists for this user");
            }

            const indexDoc = await transaction.get(indexRef);
            const index = indexDoc.exists ? indexDoc.data().index : 0;

            // Derive the wallet for the current index
            const wallet = deriveWallet(index);

            // Update the user's wallets with the new EVM wallet
            userWallets["EVM"] = {
                address: String(wallet.address).toLowerCase(),
                walletIndex: index,
            };

            // Add the address to Moralis stream
            await addToMoralisStream(wallet.address);

            // Increment the shared index for EVM coins and update Firestore
            transaction.set(indexRef, { index: index + 1 });
            transaction.update(userRef, { wallets: userWallets });

            // Respond with the new wallet
            res.status(200).json({
                message: `Wallet address generated successfully!`,
                wallet: userWallets["EVM"],
            });
        });
    } catch (error) {
        console.error("Error generating EVM wallet:", error.message);
        res.status(500).json({ message: "Failed to generate EVM wallet", error: error.message });
    }
};
