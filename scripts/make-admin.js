const { auth, db } = require("../config/firebase");

async function makeAdmin() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    throw new Error(
      "Usage: node scripts/make-admin.js your-email@example.com"
    );
  }

  const user = await auth.getUserByEmail(email);

  await auth.setCustomUserClaims(user.uid, {
    role: "admin"
  });

  await db.collection("employees").doc(user.uid).set(
    {
      uid: user.uid,
      email: user.email.toLowerCase(),
      role: "admin",
      status: "approved",
      outletIds: [],
      approvedAt:
        require("firebase-admin/firestore").FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  console.log(`Administrator setup completed for ${user.email}`);
}

makeAdmin().catch((error) => {
  console.error("Administrator setup failed:", error.message);
  process.exitCode = 1;
});