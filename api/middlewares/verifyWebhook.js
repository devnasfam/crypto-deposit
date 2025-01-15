import { config } from "dotenv";
import Web3 from "web3";
config();

const secret = process.env.MORALIS_WEBHOOK_SECRET;
// Middleware to verify Moralis webhook signatures
export const verifySignature = (req, res, next) => {
    const providedSignature = req.headers["x-signature"];
    if (!providedSignature) {
        console.log("Signature not provided");
        return res.status(401).json({ error: "Signature not provided" });
    }
    const generatedSignature = Web3.utils.sha3(JSON.stringify(req.body) + secret);
    // Compare the generated signature with the provided signature
    if (generatedSignature !== providedSignature) {
        console.log("Invalid Signature");
        return res.status(401).json({ error: "Invalid Signature" });
    }
    // Signature is valid; proceed to the next middleware or route handler
    next();
};
