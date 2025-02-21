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
const USDT_BSC_ADDRESS = "0x55d398326f99059ff775485246999027b3197955".toLowerCase();
const USDT_MATIC_ADDRESS = "0xc2132d05d31c914a87c6611c10748ae04b58e8f".toLowerCase();

// Function to derive the wallet private key from the HD wallet for a given index
function getWalletPrivateKey(index) {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
    const wallet = masterNode.derivePath(derivationPath);
    return wallet.privateKey;
}

async function fetchTokenPrice(chainId, isERC20 = false) {
    try {
        if (isERC20) return 1.0; // USDT is pegged to $1
        const coinSymbol = getCoinSymbolByChainId(chainId);
        const coinsData = await getCoinsData();
        let coinData = coinsData.find((data) => data.symbol === coinSymbol);
        if (!coinData && ["ARB_ETH", "BASE_ETH", "BLAST_ETH", "LINEA_ETH"].includes(coinSymbol)) {
            coinData = coinsData.find((data) => data.symbol === "ETH");
        }
        if (!coinData) throw new Error(`Coin data not found for chainId ${chainId}`);
        return coinData.price_usd;
    } catch (error) {
        console.error("Error fetching token price:", error.message);
        throw error;
    }
}

export const handleDepositWebhook = async (req, res) => {
    const { confirmed, chainId, txs = [], erc20Transfers = [] } = req.body;

    // Validate that at least one transaction or ERC-20 transfer exists
    if ((!txs || txs.length === 0) && (!erc20Transfers || erc20Transfers.length === 0)) {
        console.warn("Invalid transaction data received");
        return res.status(400).json({ message: "Invalid transaction data received" });
    }

    try {
        const usersRef = db.collection("Users");
        const usdToNgnRate = (await db.collection("Rates").doc("usdToNgn").get()).data()?.usdDeposit || 1640;

        // ------------------------
        // Process native token deposits
        // ------------------------
        for (const tx of txs) {
            const { hash, toAddress, value, fromAddress } = tx;
            if (!hash || !toAddress || !value || value === "0") continue;

            const userQuery = await usersRef.where("wallets.EVM.address", "==", toAddress.toLowerCase()).get();
            if (userQuery.empty) continue;

            const userDoc = userQuery.docs[0];
            const userData = userDoc.data();
            const walletIndex = userData.wallets.EVM.walletIndex;

            const tokenPriceUSD = await fetchTokenPrice(chainId);
            const amountEther = ethers.formatEther(value);
            const usdValue = parseFloat(amountEther) * tokenPriceUSD;
            const amountNGN = usdValue * usdToNgnRate;

            const transactionsRef = db.collection("Transactions").doc(hash);
            const transactionDoc = await transactionsRef.get();

            if (!confirmed) {
                if (!transactionDoc.exists) {
                    await transactionsRef.set({
                        hash,
                        fromAddress,
                        toAddress,
                        value,
                        userId: userData.id,
                        chainId,
                        tokenName: getCoinSymbolByChainId(chainId),
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
                    console.log("Native transaction logged as pending:", hash);
                }
            } else {
                if (!transactionDoc.exists) {
                    console.warn("Pending native transaction not found:", hash);
                    continue;
                }
                await transactionsRef.update({ status: "success", confirmedAt: new Date().toISOString() });
                const newBalance = (userData.balance || 0) + amountNGN;
                await usersRef.doc(userDoc.id).update({ balance: newBalance });
                console.log("User balance updated with native deposit:", newBalance);

                // Transfer native token to central wallet
                const privateKey = getWalletPrivateKey(walletIndex);
                const coinSymbol = getCoinSymbolByChainId(chainId);
                const myProvider = providers.find((coin) => coin.name === coinSymbol);
                const provider = new ethers.JsonRpcProvider(myProvider.url.main);
                const wallet = new ethers.Wallet(privateKey, provider);
                const walletBalance = await provider.getBalance(wallet.address);

                const feeData = await provider.getFeeData();
                if (!feeData.gasPrice) throw new Error("Failed to retrieve gas price");
                const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, "gwei"));
                const mediumFeeGwei = gasPriceGwei * 1.5;
                const mediumFeeInWei = ethers.parseUnits(mediumFeeGwei.toFixed(9), "gwei");

                const estimatedGasLimit = await provider.estimateGas({
                    to: CENTRAL_WALLET,
                    value: walletBalance,
                });
                const gasCost = estimatedGasLimit * mediumFeeInWei;
                const bufferInWei = (walletBalance * BigInt(101)) / 100n; // 1% buffer
                const transferableAmount = walletBalance - gasCost - bufferInWei;

                if (transferableAmount > 0n) {
                    const nativeTx = await wallet.sendTransaction({
                        to: CENTRAL_WALLET,
                        value: transferableAmount,
                        gasLimit: estimatedGasLimit,
                        gasPrice: mediumFeeInWei,
                    });
                    console.log("Native funds transferred to central wallet:", nativeTx.hash);
                }
            }
        }

        // ------------------------
        // Process ERC-20 USDT deposits on BSC and Matic
        // ------------------------
        // Accept USDT deposits on BSC (chainId '0x38') and on Matic/Polygon (chainId '0x89')
        if ((chainId === '0x38' || chainId === '0x89') && erc20Transfers && erc20Transfers.length > 0) {
            // Choose the expected USDT contract based on the chain
            const expectedUSDTAddress = chainId === '0x38' ? USDT_BSC_ADDRESS : USDT_MATIC_ADDRESS;
            // Choose the RPC provider for USDT transfers
            const rpcUrl = chainId === '0x38'
                ? "https://bsc-dataseed.binance.org/"
                : "https://polygon-rpc.com/";
            const provider = new ethers.JsonRpcProvider(rpcUrl);

            for (const transfer of erc20Transfers) {
                if (transfer.contract.toLowerCase() !== expectedUSDTAddress) continue;

                const toAddress = transfer.to;
                const userQuery = await usersRef.where("wallets.EVM.address", "==", toAddress.toLowerCase()).get();
                if (userQuery.empty) continue;

                const userDoc = userQuery.docs[0];
                const userData = userDoc.data();
                const walletIndex = userData.wallets.EVM.walletIndex;

                const decimals = parseInt(transfer.tokenDecimals) || 6; // USDT typically has 6 decimals
                const amountToken = ethers.formatUnits(transfer.value, decimals); // Human-readable USDT amount
                const usdValue = parseFloat(amountToken) * 1.0; // USDT is pegged to $1
                const amountNGN = usdValue * usdToNgnRate;

                const txHash = transfer.transactionHash;
                const transactionsRef = db.collection("Transactions").doc(txHash);
                const transactionDoc = await transactionsRef.get();

                if (!confirmed) {
                    if (!transactionDoc.exists) {
                        await transactionsRef.set({
                            hash: txHash,
                            fromAddress: transfer.from,
                            toAddress,
                            value: transfer.value,
                            userId: userData.id,
                            chainId,
                            amountToken,
                            tokenSymbol: "USDT",
                            tokenDecimals: decimals,
                            amountUSD: usdValue,
                            tokenPriceUSD: 1.0,
                            amountNGN,
                            status: "pending",
                            type: "crypto-deposit",
                            date: new Date().toISOString(),
                            createdAt: new Date().toISOString(),
                        });
                        console.log("USDT transaction logged as pending:", txHash);
                    }
                } else {
                    if (!transactionDoc.exists) {
                        console.warn("Pending USDT transaction not found:", txHash);
                        continue;
                    }
                    await transactionsRef.update({ status: "success", confirmedAt: new Date().toISOString() });
                    const newBalance = (userData.balance || 0) + amountNGN;
                    await usersRef.doc(userDoc.id).update({ balance: newBalance });
                    console.log("User balance updated with USDT deposit:", newBalance);

                    // --- Transfer USDT to central wallet ---
                    const privateKey = getWalletPrivateKey(walletIndex);
                    const userWallet = new ethers.Wallet(privateKey, provider);
                    // Minimal ERC-20 ABI for transfer
                    const erc20Abi = [
                        "function transfer(address to, uint256 amount) public returns (bool)"
                    ];
                    const usdtContract = new ethers.Contract(expectedUSDTAddress, erc20Abi, userWallet);

                    try {
                        const usdtTx = await usdtContract.transfer(CENTRAL_WALLET, transfer.value);
                        console.log("USDT transferred to central wallet:", usdtTx.hash);
                    } catch (transferError) {
                        console.error("Error transferring USDT to central wallet:", transferError.message);
                    }
                }
            }
        }

        return res.status(200).json({ message: "Deposit processed successfully" });
    } catch (error) {
        console.error("Error handling deposit webhook:", error.message);
        res.status(500).json({ message: "Failed to process webhook", error: error.message });
    }
};


// import { config } from "dotenv";
// import { ethers } from "ethers";
// import { db } from "../firebase.js";
// import { getCoinsData } from "../utils/coinsData.js";
// import { getCoinSymbolByChainId } from "../utils/getCoinSymbol.js";
// import { providers } from "../utils/providers.js";
// config();

// const mnemonic = process.env.HD_WALLET_PHRASE;
// const CENTRAL_WALLET = "0x41DF1029A8637900D3171Ea0Fb177720FA5ce049";
// const GAS_LIMIT = 21000;
// // Function to derive the wallet private key from the HD wallet for a given index
// function getWalletPrivateKey(index) {
//     const derivationPath = `m/44'/60'/0'/0/${index}`;
//     const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
//     const wallet = masterNode.derivePath(derivationPath);
//     return wallet.privateKey;
// }

// // Fetch token price from coins data
// async function fetchTokenPrice(chainId) {
//     try {
//         const coinSymbol = getCoinSymbolByChainId(chainId);
//         const coinsData = await getCoinsData();
//         let coinData = coinsData.find((data) => data.symbol === coinSymbol);

//         // Handle special cases for EVM forks
//         if (!coinData && ["ARB_ETH", "BASE_ETH", "BLAST_ETH", "LINEA_ETH"].includes(coinSymbol)) {
//             coinData = coinsData.find((data) => data.symbol === "ETH");
//         }

//         if (!coinData) {
//             throw new Error(`Coin data not found for chainId ${chainId}`);
//         }

//         return coinData.price_usd;
//     } catch (error) {
//         console.error("Error fetching token price:", error.message);
//         throw new Error("Failed to fetch token price.");
//     }
// }

// // Webhook handler for deposit processing
// export const handleDepositWebhook = async (req, res) => {
//     const { confirmed, chainId, txs } = req.body;
//     console.log("Webhook received:", req.body);
//     // Validate the request
//     if (!txs || !Array.isArray(txs) || txs.length === 0) {
//         console.warn("Invalid transaction data received");
//         console.log('webhook received:', req.body)
//         return res.status(400).json({ message: "Invalid transaction data received" });
//     }

//     const tx = txs[0];
//     const { hash, toAddress, value, fromAddress } = tx;

//     if (!hash || !toAddress || !value || value === "0") {
//         console.warn("Invalid transaction fields in webhook");
//         console.log('webhook received:', req.body);
//         return res.status(400).json({ message: "Invalid transaction fields" });
//     }

//     try {
//         const transactionsRef = db.collection("Transactions").doc(hash);
//         const transactionDoc = await transactionsRef.get();
//         const usersRef = db.collection("Users");

//         // Find user by toAddress
//         const userQuery = await usersRef.where("wallets.EVM.address", "==", String(toAddress).toLowerCase()).get();
//         if (userQuery.empty) {
//             console.log("No user found for toAddress. Ignoring non-deposit transaction:", toAddress);
//             return res.status(200).json({ message: "Transaction is not an incoming deposit. Ignored." });
//         }

//         const userDoc = userQuery.docs[0];
//         const userData = userDoc.data();
//         const walletIndex = userData.wallets.EVM.walletIndex;

//         // Fetch token price
//         const tokenPriceUSD = await fetchTokenPrice(chainId);
//         const usdToNgnRate = (await db.collection("Rates").doc("usdToNgn").get()).data()?.usdDeposit || 1640;

//         // Calculate amounts
//         const amountEther = ethers.formatEther(value);
//         const usdValue = parseFloat(amountEther) * tokenPriceUSD;
//         const amountNGN = usdValue * usdToNgnRate;

//         console.log("Transaction Details:");
//         console.log(`  Amount: ${amountEther} ${getCoinSymbolByChainId(chainId)}`);
//         console.log(`  Amount (USD): ${usdValue}`);
//         console.log(`  Amount (NGN): ${amountNGN}`);
//         console.log(`  Address: ${toAddress}`);

//         // Step 1: Handle unconfirmed transactions
//         if (!confirmed) {
//             if (!transactionDoc.exists) {
//                 await transactionsRef.set({
//                     hash,
//                     fromAddress,
//                     toAddress,
//                     value,
//                     userId: userData.id,
//                     chainId,
//                     amountEther,
//                     amountNGN,
//                     coinSymbol: getCoinSymbolByChainId(chainId),
//                     amountUSD: usdValue,
//                     tokenPriceUSD,
//                     status: "pending",
//                     type: "crypto-deposit",
//                     date: new Date().toISOString(),
//                     createdAt: new Date().toISOString(),
//                 });
//                 console.log("Transaction logged as pending:", hash);
//             }
//             return res.status(200).json({ message: "Transaction logged as pending" });
//         }

//         // Step 2: Handle confirmed transactions
//         if (confirmed) {
//             if (!transactionDoc.exists) {
//                 console.warn("Pending transaction not found:", hash);
//                 return res.status(404).json({ message: "Pending transaction not found" });
//             }

//             // Update transaction status to success
//             await transactionsRef.update({ status: "success", confirmedAt: new Date().toISOString() });

//             // Update user balance
//             const newBalance = (userData.balance || 0) + amountNGN;
//             await usersRef.doc(userDoc.id).update({ balance: newBalance });
//             console.log("User balance updated:", newBalance);

//             // // Transfer funds to the central wallet
//             const privateKey = getWalletPrivateKey(walletIndex);
//             const coinSymbol = getCoinSymbolByChainId(chainId);
//             const myProvider = providers.find((coin) => coin.name === coinSymbol);
//             const provider = new ethers.JsonRpcProvider(myProvider.url.main);
//             const wallet = new ethers.Wallet(privateKey, provider);
//             const walletBalance = await provider.getBalance(wallet.address);

// // Fetch current fee data
// const feeData = await provider.getFeeData();
// if (!feeData.gasPrice) {
//     throw new Error("Failed to retrieve gas price from provider.");
// }

// // Convert gas price from Wei to Gwei
// const gasPriceGwei = Number(ethers.formatUnits(feeData.gasPrice, "gwei"));
// const mediumFeeGwei = gasPriceGwei + gasPriceGwei / 2; // 1.5x the base fee
// const mediumFeeInWei = ethers.parseUnits(mediumFeeGwei.toFixed(9), "gwei"); // Convert Gwei back to Wei

// console.log(`Gas Prices: Low=${gasPriceGwei} Gwei, Medium=${mediumFeeGwei} Gwei`);

// // Estimate the required gas limit
// const estimatedGasLimit = await provider.estimateGas({
//     to: CENTRAL_WALLET,
//     value: walletBalance, // Provide max balance for estimation
// });
// console.log(`Estimated Gas Limit: ${estimatedGasLimit}`);

// // Calculate the gas cost
// const gasCost = BigInt(estimatedGasLimit.toString()) * BigInt(mediumFeeInWei.toString());

// // Calculate a percentage-based buffer (e.g., 5% of the wallet balance)
// const bufferPercentage = 0.01; // 1% buffer
// const walletBalanceBigInt = BigInt(walletBalance.toString());
// const bufferInWei = BigInt(walletBalanceBigInt * BigInt(Math.floor(bufferPercentage * 100)) / 100n);

// // Calculate the transferable amount (wallet balance - gas cost - buffer)
// const transferableAmount = walletBalanceBigInt - gasCost - bufferInWei;

// if (transferableAmount <= 0n) {
//     throw new Error(
//         `Insufficient balance after reserving gas and buffer. Wallet Balance: ${ethers.formatEther(walletBalance)}, Gas Cost: ${ethers.formatEther(
//             gasCost
//         )}, Buffer: ${ethers.formatEther(bufferInWei)}`
//     );
// }

// console.log(`Transferable Amount (after buffer): ${ethers.formatEther(transferableAmount)} ETH`);

// // Create and send the transaction
// try {
//     const tx = await wallet.sendTransaction({
//         to: CENTRAL_WALLET,
//         value: transferableAmount, // Send the remaining balance minus gas cost and buffer
//         gasLimit: estimatedGasLimit,
//         gasPrice: mediumFeeInWei,
//     });

//     console.log("Transaction Sent:", tx.hash);

//     // Wait for the transaction confirmation
//     const receipt = await tx.wait();
//     console.log("Transaction Confirmed:", receipt.transactionHash);
// } catch (error) {
//     console.error("Error sending transaction:", error.message);

//     if (error.code === "INSUFFICIENT_FUNDS") {
//         console.error(
//             `Insufficient funds error. Wallet Balance: ${ethers.formatEther(walletBalance)}, Total Gas Cost: ${ethers.formatEther(
//                 gasCost
//             )}, Buffer: ${ethers.formatEther(bufferInWei)}`
//         );
//     }
// }



//             return res.status(200).json({
//                 message: "Deposit processed successfully",
//                 transactionHash: hash,
//             });
//         }
//     } catch (error) {
//         console.error("Error handling deposit webhook:", error.message);
//         res.status(500).json({ message: "Failed to process webhook", error: error.message });
//     }
// };
