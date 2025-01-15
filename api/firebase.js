import admin from 'firebase-admin';
import dotenv from 'dotenv';
dotenv.config();

const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY;
const firebasePrivateKeyId = process.env.FIREBASE_PRIVATE_KEY_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebaseClientId = process.env.FIREBASE_CLIENT_ID;
const firebaseClientCertUri = process.env.FIREBASE_CLIENT_CERT_URI;
const projectId = process.env.FIREBASE_PROJECT_ID;

const serviceAccount = {
  type: "service_account",
  project_id: projectId,
  private_key_id: firebasePrivateKeyId,
  private_key: firebasePrivateKey ? firebasePrivateKey.replace(/\\n/g, '\n') : undefined,
  client_email: firebaseClientEmail,
  client_id: firebaseClientId,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: firebaseClientCertUri,
  universe_domain: "googleapis.com"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

export { admin, db };
