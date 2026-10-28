
const express = require("express");
const { auth, db } = require("../config/firebase");
const shiftService = require("../services/shift.service");

const router = express.Router();

async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const decoded = await auth.verifyIdToken(header.slice(7));
    const employeeSnap = await db
      .collection("employees")
      .doc(decoded.uid)
      .get();

    if (
      decoded.role !== "admin" ||
      !employeeSnap.exists ||
      employeeSnap.data().role !== "admin" ||
      employeeSnap.data().status !== "approved"
    ) {
      return res.status(403).json({
        success: false,
        message: "Approved administrator access required."
      });
    }

    req.admin = { uid: decoded.uid };
    next();
  } catch (error) {
    console.error("Shift authorization error:", error.message);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

router.use(requireAdmin);

// List all shifts.
router.get("/", async (req, res) => {
  try {
    const shifts = await shiftService.getShifts();
    return res.json({ success: true, shifts });
  } catch (error) {
    console.error("List shifts error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load shifts."
    });
  }
});

// Create a shift.
router.post("/", async (req, res) => {
  try {
    const shift = await shiftService.createShift(
      req.body || {},
      req.admin.uid
    );

    return res.status(201).json({
      success: true,
      message: "Shift created successfully.",
      shift
    });
  } catch (error) {
    console.error("Create shift error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Could not create shift."
    });
  }
});

// Update a shift's settings.
router.patch("/:id", async (req, res) => {
  try {
    const shift = await shiftService.updateShift(
      req.params.id,
      req.body || {},
      req.admin.uid
    );

    return res.json({
      success: true,
      message: "Shift updated successfully.",
      shift
    });
  } catch (error) {
    console.error("Update shift error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Could not update shift."
    });
  }
});

// Activate or deactivate a shift.
router.patch("/:id/active", async (req, res) => {
  try {
    const shift = await shiftService.setShiftActive(
      req.params.id,
      req.body?.active,
      req.admin.uid
    );

    return res.json({
      success: true,
      message: `Shift ${shift.active ? "activated" : "deactivated"} successfully.`,
      shift
    });
  } catch (error) {
    console.error("Change shift status error:", error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode
        ? error.message
        : "Could not change shift status."
    });
  }
});

module.exports = router;
