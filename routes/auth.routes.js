
const express = require("express");
const { auth, db } = require("../config/firebase");

const router = express.Router();
// Public registration options: active outlets only.
router.get("/outlets", async (req, res) => {
  try {
    const snapshot = await db.collection("outlets")
      .where("active", "==", true)
      .get();

    const outlets = snapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name || "",
      address: doc.data().address || ""
    }));

    outlets.sort((a, b) => a.name.localeCompare(b.name));

    return res.json({ success: true, outlets });
  } catch (error) {
    console.error("Registration outlets error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load available outlets."
    });
  }
});

router.post("/register", async (req, res) => {
  let createdUser = null;

  try {
    const { name, email, phone, requestedOutletId } = req.body;

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof phone !== "string" ||
      typeof requestedOutletId !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !phone.trim() ||
      !requestedOutletId.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email, phone, and outlet are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const cleanPhone = phone.trim();

    // The browser creates the account using Firebase client Auth.
    // This endpoint saves the employee profile after receiving
    // a verified Firebase ID token.
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Please sign in with Firebase before completing registration."
      });
    }

    const decoded = await auth.verifyIdToken(header.slice(7));

    if (!decoded.email || decoded.email.toLowerCase() !== normalizedEmail) {
      return res.status(403).json({
        success: false,
        message: "The signed-in email does not match the registration email."
      });
    }

    const employeeRef = db.collection("employees").doc(decoded.uid);
    const existing = await employeeRef.get();

    if (existing.exists) {
      return res.status(409).json({
        success: false,
        message: "An employee profile already exists for this account."
      });
    }
    const outletId = requestedOutletId.trim();
    const outletRef = db.collection("outlets").doc(outletId);
    const outletSnap = await outletRef.get();

if (!outletSnap.exists || outletSnap.data().active !== true) {
  return res.status(400).json({
    success: false,
    message: "Please select a valid, active outlet."
  });
}

    await employeeRef.create({
      uid: decoded.uid,
      name: cleanName,
      email: normalizedEmail,
      phone: cleanPhone,
      requestedOutletId: outletId,
      status: "pending",
      role: "employee",
      outletIds: [],
      createdAt: new Date().toISOString()
    });

    return res.status(201).json({
      success: true,
      status: "pending",
      message: "Registration submitted. Wait for management approval."
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Registration could not be completed."
    });
  }
});

router.get("/me", async (req, res) => {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const decoded = await auth.verifyIdToken(header.slice(7));

    const employeeRef = db.collection("employees").doc(decoded.uid);
    const employeeSnap = await employeeRef.get();

    if (!employeeSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Employee profile not found."
      });
    }

    const employee = employeeSnap.data();

    return res.json({
      success: true,
      status: employee.status,
      role: employee.role,
      name: employee.name
    });
  } catch (error) {
    console.error("Profile verification error:", error.message);

    return res.status(401).json({
      success: false,
      message: "Could not verify your session."
    });
  }
});


module.exports = router;
