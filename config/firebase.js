
require("dotenv").config();

const { initializeApp, applicationDefault } =
  require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const firebaseApp = initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID || "loska-attendance"
});

const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

module.exports = { firebaseApp, auth, db };
