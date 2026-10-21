
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function getFirebaseApp() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  );

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: "quicktel-bundles"
  });
}

function getDb() {
  return getFirestore(getFirebaseApp());
}

export { getDb, FieldValue };
