import { ethers } from "ethers";

function getWalletPrivateKey(index) {
    const derivationPath = `m/44'/60'/0'/0/${index}`;
    const masterNode = ethers.HDNodeWallet.fromPhrase('', undefined, "m");
    const wallet = masterNode.derivePath(derivationPath);
    return wallet.privateKey;
}
console.log(getWalletPrivateKey(0))