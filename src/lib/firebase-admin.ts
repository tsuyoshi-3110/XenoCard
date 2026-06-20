import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccount) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not set");
  }
  initializeApp({
    credential: cert(JSON.parse(serviceAccount)),
  });
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
