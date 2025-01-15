import { config } from "dotenv";
import crypto from "crypto";
config();

const secret = process.env.MORALIS_WEBHOOK_SECRET;

// Middleware to verify Moralis webhook signatures
export const verifySignature = (req, res, next) => {
    const providedSignature = req.headers["x-signature"];
    if (!providedSignature) {
        return res.status(401).json({ error: "Signature not provided" });
    }

    // Convert the secret to a buffer
    const secretBuffer = Buffer.from(secret, 'utf-8');

    // Compute HMAC SHA256 of the raw request body
    const hmac = crypto.createHmac('sha256', secretBuffer);
    const body = JSON.stringify(req.body);
    hmac.update(body);
    const generatedSignature = hmac.digest('hex');

    // Compare the generated signature with the provided signature
    if (generatedSignature !== providedSignature) {
        return res.status(401).json({ error: "Invalid Signature" });
    }

    // Signature is valid; proceed to the next middleware or route handler
    next();
};
