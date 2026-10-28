
const { auth, db } = require("../config/firebase");

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token required."
      });
    }

    const idToken = header.slice(7);
    const decodedToken = await auth.verifyIdToken(idToken);

    const employeeRef = db.collection("employees").doc(decodedToken.uid);
    const employeeSnap = await employeeRef.get();

    if (!employeeSnap.exists) {
      return res.status(403).json({
        success: false,
        message: "Employee profile not found."
      });
    }

    const employee = employeeSnap.data();

    if (employee.status !== "approved") {
      return res.status(403).json({
        success: false,
        status: employee.status,
        message: "Your account is awaiting management approval."
      });
    }

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || null,
      employee
    };

    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

module.exports = authenticate;
