
const express = require("express");
const authenticate = require("../middleware/authenticate");
const {
  getEmployeeOptions,
  clockIn,
  clockOut,
  getCurrentAttendance
} = require("../services/attendance.service");

const router = express.Router();

function sendError(res, error) {
  console.error("Attendance API error:", error.message);

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode
      ? error.message
      : "An attendance operation failed. Please try again."
  });
}

function readLocation(body) {
  return {
    latitude: body.latitude,
    longitude: body.longitude,
    accuracyMeters: body.accuracyMeters
  };
}

// Only approved employees may use employee attendance endpoints.
router.use(authenticate, (req, res, next) => {
  if (req.user.employee.role !== "employee") {
    return res.status(403).json({
      success: false,
      message: "Employee access is required."
    });
  }

  next();
});

// Get assigned outlets, their eligible active shifts, and open session.
router.get("/options", async (req, res) => {
  try {
    const employee = {
      ...req.user.employee,
      uid: req.user.uid
    };

    const options = await getEmployeeOptions(employee);
    const currentAttendance = await getCurrentAttendance(req.user.uid);

    return res.json({
      success: true,
      ...options,
      currentAttendance
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// Start an attendance session.
router.post("/clock-in", async (req, res) => {
  try {
    const { outletId, shiftId } = req.body || {};

    if (
      typeof outletId !== "string" ||
      !outletId.trim() ||
      typeof shiftId !== "string" ||
      !shiftId.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Select an outlet and shift."
      });
    }

    const result = await clockIn({
      employee: {
        ...req.user.employee,
        uid: req.user.uid
      },
      outletId,
      shiftId,
      location: readLocation(req.body || {})
    });

    return res.status(201).json({
      success: true,
      ...result
    });
  } catch (error) {
    return sendError(res, error);
  }
});

// End the employee's open attendance session.
router.post("/clock-out", async (req, res) => {
  try {
    const result = await clockOut({
      employee: {
        ...req.user.employee,
        uid: req.user.uid
      },
      location: readLocation(req.body || {})
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
