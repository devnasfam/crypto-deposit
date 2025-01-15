import { ethers, formatEther } from "ethers";


const generateAddress = async () => {
    try {
        const wallet = ethers.Wallet.createRandom();
        const address = wallet.address;
        console.log("Address", address);
        console.log("mnemonic phrase:", wallet.mnemonic.phrase);
        console.log("private key:", wallet.privateKey);
    } catch (error) {
        console.log(error);
    }
}

generateAddress();