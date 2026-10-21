
"use strict";

const admin = require("firebase-admin");

function getFirebaseApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const rawCredentials =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!rawCredentials) {
    throw new Error(
      "Missing FIREBASE_SERVICE_ACCOUNT_JSON environment variable."
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(rawCredentials);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON."
    );
  }

  if (
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    throw new Error(
      "Firebase service-account credentials are incomplete."
    );
  }

  if (serviceAccount.project_id !== "quicktel-bundles") {
    throw new Error(
      "Firebase service-account project does not match quicktel-bundles."
    );
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: "quicktel-bundles"
  });
}

function getDb() {
  getFirebaseApp();
  return admin.firestore();
}

module.exports = {
  getDb,
  FieldValue: admin.firestore.FieldValue
};
