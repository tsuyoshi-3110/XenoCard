import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccount) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY is not set");
  }
  const parsedServiceAccount = JSON.parse(serviceAccount) as {
    project_id?: string;
    client_email?: string;
    private_key?: string;
  };

  initializeApp({
    credential: cert({
      projectId: parsedServiceAccount.project_id,
      clientEmail: parsedServiceAccount.client_email,
      privateKey: parsedServiceAccount.private_key?.replace(/\\n/g, "\n"),
    }),
  });
}

export const adminAuth = getAuth();
export const adminDb = getFirestore();
