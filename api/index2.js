import { config } from "dotenv";
import { ethers } from "ethers";
import { providers } from "./utils/providers.js";

config();

const mnemonic = process.env.HD_WALLET_PHRASE;
const BNB_USDT_CONTRACT = "0x55d398326f99059ff775485246999027b3197955"; // USDT Contract on BNB

const EVM_CHAINS = ["ETH", "LINEA_ETH", "BLAST_ETH", "ARB_ETH", "BASE_ETH", "BNB", "MATIC", "CORE", "opBNB"]; // Exclude SOL & TRX

function getWalletPrivateKey(index) {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const masterNode = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m");
    const wallet = masterNode.derivePath(derivationPath);
    return wallet.privateKey;
}

async function getProvider(url, retries = 3) {
    while (retries > 0) {
        try {
            const provider = new ethers.JsonRpcProvider(url);
            await provider.getNetwork(); // Ensure provider is connected
            return provider;
        } catch (error) {
            console.warn(`⚠️ RPC Error (${url}), retries left: ${retries - 1}`);
            retries--;
            await new Promise((res) => setTimeout(res, 1000));
        }
    }
    return null; // Return null if provider fails
}

async function checkNativeBalance(index, provider, chainName) {
    try {
        if (!provider) throw new Error("Provider is null");
        const wallet = new ethers.Wallet(getWalletPrivateKey(index), provider);
        const balance = await provider.getBalance(wallet.address);
        const balanceETH = ethers.formatEther(balance);
        return { index, chainName, address: wallet.address, balanceETH: parseFloat(balanceETH) };
    } catch (error) {
        console.error(`❌ Error checking balance for ${chainName}:`, error.message);
        return { index, chainName, address: null, balanceETH: 0 };
    }
}

async function checkUSDTBalance(index, provider) {
    try {
        if (!provider) throw new Error("Provider is null");
        const wallet = new ethers.Wallet(getWalletPrivateKey(index), provider);
        const erc20Abi = ["function balanceOf(address owner) view returns (uint256)"];
        const usdtContract = new ethers.Contract(BNB_USDT_CONTRACT, erc20Abi, provider);
        const usdtBalance = await usdtContract.balanceOf(wallet.address);
        const usdtBalanceFormatted = ethers.formatUnits(usdtBalance, 18);
        return { index, address: wallet.address, usdtBalance: parseFloat(usdtBalanceFormatted) };
    } catch (error) {
        console.error(`❌ Error checking USDT balance on BNB:`, error.message);
        return { index, address: null, usdtBalance: 0 };
    }
}

async function trackChildWallets(maxIndex = 10000) {
    let walletsWithDeposits = [];

    for (let index = 0; index < maxIndex; index++) {
        for (const providerInfo of providers) {
            if (!EVM_CHAINS.includes(providerInfo.name)) continue; // Skip non-EVM chains

            const provider = await getProvider(providerInfo.url.main);
            if (!provider) {
                console.error(`❌ Skipping ${providerInfo.name} due to RPC failure.`);
                continue;
            }

            const nativeBalance = await checkNativeBalance(index, provider, providerInfo.name);

            let usdtBalance = { usdtBalance: 0 };
            if (providerInfo.name === "BNB") {
                usdtBalance = await checkUSDTBalance(index, provider);
            }

            if (nativeBalance.balanceETH > 0 || usdtBalance.usdtBalance > 0) {
                walletsWithDeposits.push({ ...nativeBalance, ...usdtBalance });
                console.log(`✅ Wallet ${index} (${nativeBalance.address}) - ${providerInfo.name}: ${nativeBalance.balanceETH} ETH, USDT: ${usdtBalance.usdtBalance}`);
            }
        }
    }

    console.log(`📊 Total Wallets With Deposits:`, walletsWithDeposits.length);
}

trackChildWallets();
