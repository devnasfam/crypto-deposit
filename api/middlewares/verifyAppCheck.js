import { admin } from "../firebase.js";

// Middleware to verify App Check token
export const verifyAppCheckToken = async(req, res, next) =>{
  const appCheckToken = req.header('X-Firebase-AppCheck');

  if (!appCheckToken) {
    console.log('App Check token missing');
    return res.status(403).json({ error: 'App Check token missing' });
  }

  try {
    // Verify the App Check token
    const appCheckClaims = await admin.appCheck().verifyToken(appCheckToken);

    req.appCheckClaims = appCheckClaims;

    // Proceed to the next middleware or route handler
    next();
  } catch (error) {
    console.error('Error verifying App Check token:', error);
    return res.status(403).json({ error: 'Invalid App Check token' });
  }
}
