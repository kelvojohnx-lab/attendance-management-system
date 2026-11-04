
const express = require("express");
const { db } = require("../config/firebase");
const authenticate = require("../middleware/authenticate");
const {
  getNairobiDate,
  calculateAccruedLeaveBalance
} = require("../services/leave.service");

const router = express.Router();

router.use(authenticate);

// Only approved employee accounts can use employee leave routes.
router.use((req, res, next) => {
  if (req.user.employee.role !== "employee") {
    return res.status(403).json({
      success: false,
      message: "This page is for employee accounts only."
    });
  }

  next();
});

function parseDateOnly(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return date;
}

function countLeaveDays(startDate, endDate) {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  if (!start || !end || end < start) {
    return 0;
  }

  return Math.floor((end - start) / 86400000) + 1;
}

function datesOverlap(startA, endA, startB, endB) {
  return startA <= endB && startB <= endA;
}

// GET /api/leave/summary
router.get("/summary", async (req, res) => {
  try {
    const uid = req.user.uid;
    const employee = req.user.employee;
    const balanceAsOf = getNairobiDate();

    const balanceRef = db.collection("leaveBalances").doc(uid);
    const balanceSnap = await balanceRef.get();

    const openingBalance = balanceSnap.exists
      ? Number(balanceSnap.data().openingBalance)
      : 0;

    const openingBalanceAsOf = balanceSnap.exists
      ? balanceSnap.data().openingBalanceAsOf
      : null;

    const calculation = calculateAccruedLeaveBalance({
      employmentStartDate: employee.employmentStartDate,
      openingBalance,
      openingBalanceAsOf,
      asOfDate: balanceAsOf
    });

    const applicationsSnap = await db.collection("leaveApplications")
      .where("employeeUid", "==", uid)
      .get();
      const adjustmentsSnap = await db.collection("leaveTransactions")
  .where("employeeUid", "==", uid)
  .get();

let adjustmentTotal = 0;

for (const doc of adjustmentsSnap.docs) {
  const record = doc.data();

  if (record.type === "leave_adjustment") {
    const days = Number(record.days);

    if (!Number.isFinite(days)) {
      throw new Error("Invalid leave adjustment record.");
    }

    adjustmentTotal += days;
  }
}

const adjustedTotalBeforeDeductions =
  calculation.totalBeforeDeductions + adjustmentTotal;

    let approvedDays = 0;
    let pendingDays = 0;

    for (const doc of applicationsSnap.docs) {
      const application = doc.data();

      if (!["approved", "pending"].includes(application.status)) {
        continue;
      }

      const days = Number(
        application.requestedDays ||
        countLeaveDays(application.startDate, application.endDate)
      );

      if (!Number.isFinite(days) || days <= 0) {
        throw new Error("An existing leave application has invalid day information.");
      }

      if (application.status === "approved") {
        approvedDays += days;
      } else if (application.status === "pending") {
        pendingDays += days;
      }
    }

    const balanceAfterApproved =
  adjustedTotalBeforeDeductions - approvedDays;

    const availableBalance =
      balanceAfterApproved - pendingDays;

    return res.json({
      success: true,
      employeeName: employee.name || "",
      annualEntitlement: 21,
      accruedDays: calculation.accruedLeave,
      openingBalance,
      openingBalanceAsOf,
      totalBeforeDeductions: adjustedTotalBeforeDeductions,
      adjustmentTotal,
      approvedLeaveDays: approvedDays,
      pendingLeaveDays: pendingDays,
      balanceAfterApproved: Math.max(0, balanceAfterApproved),
      availableBalance: Math.max(0, availableBalance),
      balanceAsOf
    });

  } catch (error) {
    console.error("Leave summary error:", error.message);

    return res.status(400).json({
      success: false,
      message: error.message || "Could not calculate your leave balance."
    });
  }
});

// GET /api/leave/applications
router.get("/applications", async (req, res) => {
  try {
    const snapshot = await db.collection("leaveApplications")
      .where("employeeUid", "==", req.user.uid)
      .get();

    const applications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    applications.sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );

    return res.json({
      success: true,
      applications
    });

  } catch (error) {
    console.error("Leave applications error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load your leave applications."
    });
  }
});

// POST /api/leave/applications
router.post("/applications", async (req, res) => {
  try {
    const uid = req.user.uid;
    const { startDate, endDate, reason } = req.body;

    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);

    if (!start || !end || end < start) {
      return res.status(400).json({
        success: false,
        message: "Please provide valid leave dates."
      });
    }

    if (startDate < getNairobiDate()) {
      return res.status(400).json({
        success: false,
        message: "Leave applications must start today or on a future date."
      });
    }

    if (
      typeof reason !== "string" ||
      !reason.trim() ||
      reason.trim().length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a reason of up to 1,000 characters."
      });
    }

    const requestedDays = countLeaveDays(startDate, endDate);

    if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid number of leave days."
      });
    }

    const balanceRef = db.collection("leaveBalances").doc(uid);
    const employeeRef = db.collection("employees").doc(uid);
    const lockRef = db.collection("leaveApplicationLocks").doc(uid);
    const applicationRef = db.collection("leaveApplications").doc();

    await db.runTransaction(async transaction => {
      // Read all required documents and queries before writing.
      const employeeSnap = await transaction.get(employeeRef);
      const balanceSnap = await transaction.get(balanceRef);
      const lockSnap = await transaction.get(lockRef);

      if (
        !employeeSnap.exists ||
        employeeSnap.data().status !== "approved" ||
        employeeSnap.data().role !== "employee"
      ) {
        throw new Error("EMPLOYEE_NOT_APPROVED");
      }

      const currentEmployee = employeeSnap.data();

      const openingBalance = balanceSnap.exists
        ? balanceSnap.data().openingBalance
        : 0;

      const openingBalanceAsOf = balanceSnap.exists
        ? balanceSnap.data().openingBalanceAsOf
        : null;

      const calculation = calculateAccruedLeaveBalance({
        employmentStartDate: currentEmployee.employmentStartDate,
        openingBalance,
        openingBalanceAsOf,
        asOfDate: getNairobiDate()
      });

      const existingSnapshot = await transaction.get(
        db.collection("leaveApplications")
          .where("employeeUid", "==", uid)
      );
      const adjustmentsSnapshot = await transaction.get(
  db.collection("leaveTransactions")
    .where("employeeUid", "==", uid)
);

let adjustmentTotal = 0;

for (const doc of adjustmentsSnapshot.docs) {
  const record = doc.data();

  if (record.type === "leave_adjustment") {
    const days = Number(record.days);

    if (!Number.isFinite(days)) {
      throw new Error("INVALID_LEAVE_ADJUSTMENT");
    }

    adjustmentTotal += days;
  }
}

const adjustedTotalBeforeDeductions =
  calculation.totalBeforeDeductions + adjustmentTotal;

      let reservedDays = 0;

      for (const doc of existingSnapshot.docs) {
        const application = doc.data();

        if (!["pending", "approved"].includes(application.status)) {
          continue;
        }

        if (
          datesOverlap(
            startDate,
            endDate,
            application.startDate,
            application.endDate
          )
        ) {
          throw new Error("LEAVE_DATE_OVERLAP");
        }

        const days = Number(
          application.requestedDays ||
          countLeaveDays(application.startDate, application.endDate)
        );

        if (!Number.isFinite(days) || days <= 0) {
          throw new Error("INVALID_EXISTING_APPLICATION");
        }

        reservedDays += days;
      }

       const availableBalance =
    adjustedTotalBeforeDeductions - reservedDays;

      if (requestedDays > availableBalance + 0.0000001) {
        throw new Error("INSUFFICIENT_LEAVE_BALANCE");
      }

      const now = new Date().toISOString();

      transaction.create(applicationRef, {
        employeeUid: uid,
        employeeName: currentEmployee.name || "",
        startDate,
        endDate,
        requestedDays,
        reason: reason.trim(),
        status: "pending",
        createdAt: now
      });

      // Updating the same lock document serializes submissions
      // for this employee.
      transaction.set(lockRef, {
        version: lockSnap.exists
          ? Number(lockSnap.data().version || 0) + 1
          : 1,
        updatedAt: now
      }, { merge: true });
    });

    return res.status(201).json({
      success: true,
      message: "Your leave application has been submitted for management approval.",
      applicationId: applicationRef.id
    });

  } catch (error) {
    const errors = {
      EMPLOYEE_NOT_APPROVED: [
        403,
        "Your employee account is not approved."
      ],
      LEAVE_DATE_OVERLAP: [
        409,
        "You already have a pending or approved application covering some of these dates."
      ],
      INSUFFICIENT_LEAVE_BALANCE: [
        400,
        "Your requested leave exceeds your available balance."
      ],
      INVALID_EXISTING_APPLICATION: [
        409,
        "An existing leave application has invalid day information."
      ]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];

      return res.status(status).json({
        success: false,
        message
      });
    }

    console.error("Leave application submission error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not submit your leave application."
    });
  }
});

module.exports = router;
