import { config } from "dotenv";
import { admin } from "../firebase.js";
config();


export const checkAuth = async (req, res, next) => {
    const { userId } = req.body; // The user ID from the authenticated user
    const authHeader = req.headers.authorization; // Auth token from client

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized: Missing or invalid token" });
    }

    const idToken = authHeader.split("Bearer ")[1];

    try {
        // Verify Firebase Authentication token
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        // Ensure the user ID matches the one from the decoded token
        // Ensure the userId from the request matches the decoded UID
        if (userId && decodedToken.uid !== userId) {
            return res.status(403).json({ message: "Forbidden: User ID mismatch" });
        }

        next();
    } catch (error) {
        console.error("Error verifying Firebase ID token:", error);

        if (error.code === "auth/id-token-expired") {
            return res.status(401).json({ message: "Unauthorized: Token expired" });
        }

        if (error.code === "auth/argument-error") {
            return res.status(400).json({ message: "Bad Request: Invalid token" });
        }

        res.status(500).json({ message: "Internal Server Error" });
    }
};
