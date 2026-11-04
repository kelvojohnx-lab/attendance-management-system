const express = require("express");
const { auth, db } = require("../config/firebase");
const {
  getNairobiDate,
  calculateAccruedLeaveBalance
} = require("../services/leave.service");
const router = express.Router();

// Verify that the signed-in Firebase user is an approved administrator.
async function requireAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const decoded = await auth.verifyIdToken(token);
    const employeeRef = db.collection("employees").doc(decoded.uid);
    const employeeSnap = await employeeRef.get();

    if (!employeeSnap.exists) {
      return res.status(403).json({
        success: false,
        message: "Administrator profile not found."
      });
    }

    const employee = employeeSnap.data();

    if (
      decoded.role !== "admin" ||
      employee.role !== "admin" ||
      employee.status !== "approved"
    ) {
      return res.status(403).json({
        success: false,
        message: "Administrator access denied."
      });
    }

    req.admin = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (error) {
    console.error("Admin authorization error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

// List employees awaiting management approval.
router.get("/pending-employees", requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection("employees")
      .where("status", "==", "pending")
      .get();

    const employees = snapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name || "",
      email: doc.data().email || "",
      phone: doc.data().phone || "",
      createdAt: doc.data().createdAt || null
    }));

    return res.json({ success: true, employees });
  } catch (error) {
    console.error("List pending employees error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load pending employees."
    });
  }
});

/* List approved employees for outlet assignments. */
router.get("/approved-employees", requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection("employees")
      .where("status", "==", "approved")
      .get();

    const employees = snapshot.docs
      .map(doc => {
        const employee = doc.data();

        return {
          id: doc.id,
          name: employee.name || "",
          email: employee.email || "",
          phone: employee.phone || "",
          role: employee.role || "employee",
          outletIds: Array.isArray(employee.outletIds)
            ? employee.outletIds
            : []
        };
      })
      .filter(employee => employee.role === "employee")
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({
      success: true,
      employees
    });
  } catch (error) {
    console.error("List approved employees error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load approved employees."
    });
  }
});


// Approve an employee.

const { FieldValue } = require("firebase-admin/firestore");

// Approve an employee and assign their requested home outlet.
router.patch("/employees/:uid/approve", requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid || uid === req.admin.uid) {
      return res.status(400).json({
        success: false,
        message: "Invalid employee ID."
      });
    }

    const employeeRef = db.collection("employees").doc(uid);

    await db.runTransaction(async transaction => {
      const employeeSnap = await transaction.get(employeeRef);

      if (!employeeSnap.exists) {
        throw new Error("EMPLOYEE_NOT_FOUND");
      }

      const employee = employeeSnap.data();

      if (employee.role === "admin") {
        throw new Error("CANNOT_CHANGE_ADMIN");
      }

      if (employee.status !== "pending") {
        throw new Error("EMPLOYEE_NOT_PENDING");
      }

      const outletId = employee.requestedOutletId;

      if (typeof outletId !== "string" || !outletId.trim()) {
        throw new Error("OUTLET_SELECTION_REQUIRED");
      }

      const outletRef = db.collection("outlets").doc(outletId);
      const outletSnap = await transaction.get(outletRef);

      if (!outletSnap.exists || outletSnap.data().active !== true) {
        throw new Error("REQUESTED_OUTLET_UNAVAILABLE");
      }

      const outlet = outletSnap.data();
      const employeeIds = Array.isArray(outlet.employeeIds)
        ? outlet.employeeIds
        : [];

      transaction.update(employeeRef, {
        status: "approved",
        employmentStartDate: employmentStartDate,
        outletIds: [...new Set([
          ...(Array.isArray(employee.outletIds) ? employee.outletIds : []),
          outletId
        ])],
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: req.admin.uid
      });

      transaction.update(outletRef, {
        employeeIds: [...new Set([...employeeIds, uid])]
      });
    });

    await db.collection("auditLogs").add({
      action: "employee_approved",
      employeeUid: uid,
      performedBy: req.admin.uid,
      createdAt: FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      message: "Employee approved and assigned to their selected outlet."
    });
  } catch (error) {
    if (error.message === "EMPLOYEE_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Employee not found."
      });
    }

    if (error.message === "EMPLOYEE_NOT_PENDING") {
      return res.status(409).json({
        success: false,
        message: "Employee is not awaiting approval."
      });
    }

    if (error.message === "CANNOT_CHANGE_ADMIN") {
      return res.status(403).json({
        success: false,
        message: "Administrator accounts cannot be changed here."
      });
    }

    if (error.message === "OUTLET_SELECTION_REQUIRED") {
      return res.status(400).json({
        success: false,
        message: "This employee has no requested outlet. Ask them to register again or assign an outlet before approval."
      });
    }

    if (error.message === "REQUESTED_OUTLET_UNAVAILABLE") {
      return res.status(409).json({
        success: false,
        message: "The employee's selected outlet is no longer active. Please resolve the outlet selection before approving."
      });
    }

    console.error("Approve employee error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not approve employee."
    });
  }
});


// Reject a pending employee.
// Reject a pending employee.
router.patch("/employees/:uid/reject", requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid || uid === req.admin.uid) {
      return res.status(400).json({
        success: false,
        message: "Invalid employee ID."
      });
    }

    const employeeRef = db.collection("employees").doc(uid);
    const employeeSnap = await employeeRef.get();

    if (!employeeSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Employee not found."
      });
    }

    if (employeeSnap.data().role === "admin") {
      return res.status(403).json({
        success: false,
        message: "Administrator accounts cannot be rejected here."
      });
    }

    if (employeeSnap.data().status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "Employee is not awaiting approval."
      });
    }

    await employeeRef.update({
      status: "rejected",
      rejectedAt: require("firebase-admin/firestore")
        .FieldValue.serverTimestamp(),
      rejectedBy: req.admin.uid
    });

    await db.collection("auditLogs").add({
      action: "employee_rejected",
      employeeUid: uid,
      performedBy: req.admin.uid,
      createdAt: require("firebase-admin/firestore")
        .FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      message: "Employee registration rejected."
    });
  } catch (error) {
    console.error("Reject employee error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not reject employee."
    });
  }
});

/* List attendance records for the administrator's records page. */
router.get("/attendance-records", requireAdmin, async (req, res) => {
  try {
    const { dateFrom, dateTo, outletId, employeeUid } = req.query;

    // Validate optional date filters.
    if (
      (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) ||
      (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo))
    ) {
      return res.status(400).json({
        success: false,
        message: "Dates must use YYYY-MM-DD format."
      });
    }

    if (
      (dateFrom && Number.isNaN(Date.parse(`${dateFrom}T00:00:00Z`))) ||
      (dateTo && Number.isNaN(Date.parse(`${dateTo}T00:00:00Z`)))
    ) {
      return res.status(400).json({
        success: false,
        message: "A date filter is invalid."
      });
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return res.status(400).json({
        success: false,
        message: "The start date must not be after the end date."
      });
    }

    const snapshot = await db.collection("attendance").get();

    const records = snapshot.docs
      .map(doc => {
        const data = doc.data();

        return {
          id: doc.id,
          employeeUid: data.employeeUid || "",
          employeeName: data.employeeName || "",
          outletId: data.outletId || "",
          outletName: data.outletName || "",
          shiftId: data.shiftId || "",
          shiftName: data.shiftName || "",
          arrivalStatus: data.arrivalStatus || "unknown",
          minutesLate: Number.isFinite(data.minutesLate) ? data.minutesLate : 0,
          clockInAt: data.clockInAt?.toDate?.()?.toISOString() || null,
          clockOutAt: data.clockOutAt?.toDate?.()?.toISOString() || null,
          status: data.status || "unknown"
        };
      })
      .filter(record => {
        if (outletId && record.outletId !== outletId) return false;
        if (employeeUid && record.employeeUid !== employeeUid) return false;

        // Date filtering uses the clock-in date in UTC.
        const clockInDate = record.clockInAt
          ? record.clockInAt.slice(0, 10)
          : "";

        if (dateFrom && (!clockInDate || clockInDate < dateFrom)) {
          return false;
        }

        if (dateTo && (!clockInDate || clockInDate > dateTo)) {
          return false;
        }

        return true;
      })
      .sort((a, b) =>
        (b.clockInAt || "").localeCompare(a.clockInAt || "")
      )
      .slice(0, 1000);

    return res.json({
      success: true,
      count: records.length,
      records
    });
  } catch (error) {
    console.error("Attendance records error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load attendance records."
    });
  }
});

// List approved employees and their annual leave opening balances.
router.get("/leave-balances", requireAdmin, async (req, res) => {
  try {
    const employeesSnapshot = await db.collection("employees")
      .where("status", "==", "approved")
      .get();

    const employees = employeesSnapshot.docs
      .map(doc => ({
        id: doc.id,
        name: doc.data().name || "",
        email: doc.data().email || "",
        role: doc.data().role || "employee"
      }))
      .filter(employee => employee.role === "employee")
      .sort((a, b) => a.name.localeCompare(b.name));

    const balances = await Promise.all(
      employees.map(async employee => {
        const balanceSnap = await db.collection("leaveBalances")
          .doc(employee.id)
          .get();

        return {
          ...employee,
          openingBalance: balanceSnap.exists
            ? balanceSnap.data().openingBalance
            : null,
          openingBalanceAsOf: balanceSnap.exists
            ? balanceSnap.data().openingBalanceAsOf
            : null,
          initialized: balanceSnap.exists
        };
      })
    );

    return res.json({ success: true, employees: balances });
  } catch (error) {
    console.error("Leave balances list error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load leave balances."
    });
  }
});


// Create an employee's one-time annual leave opening balance.
router.post("/leave-balances/:uid/opening", requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { openingBalance, openingBalanceAsOf } = req.body;

    if (
      typeof openingBalance !== "number" ||
      !Number.isFinite(openingBalance) ||
      openingBalance < 0 ||
      openingBalance > 365
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid opening balance between 0 and 365 days."
      });
    }

    if (
      typeof openingBalanceAsOf !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(openingBalanceAsOf)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid opening balance date in YYYY-MM-DD format."
      });
    }

    const parsedDate = new Date(`${openingBalanceAsOf}T00:00:00Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== openingBalanceAsOf
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid opening balance date."
      });
    }

    // Get today's date in the Africa/Nairobi time zone.
    const dateParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Nairobi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const today = `${dateParts.find(p => p.type === "year").value}-${dateParts.find(p => p.type === "month").value}-${dateParts.find(p => p.type === "day").value}`;

    if (openingBalanceAsOf > today) {
      return res.status(400).json({
        success: false,
        message: "Opening balance date cannot be in the future."
      });
    }

    const employeeRef = db.collection("employees").doc(uid);
    const balanceRef = db.collection("leaveBalances").doc(uid);
    const auditRef = db.collection("auditLogs").doc();

    await db.runTransaction(async transaction => {
      const employeeSnap = await transaction.get(employeeRef);
      const balanceSnap = await transaction.get(balanceRef);

      if (
        !employeeSnap.exists ||
        employeeSnap.data().status !== "approved" ||
        employeeSnap.data().role !== "employee"
      ) {
        throw new Error("APPROVED_EMPLOYEE_NOT_FOUND");
      }

      if (balanceSnap.exists) {
        throw new Error("OPENING_BALANCE_ALREADY_EXISTS");
      }

      transaction.create(balanceRef, {
        employeeUid: uid,
        openingBalance,
        openingBalanceAsOf,
        createdAt: new Date().toISOString(),
        createdBy: req.admin.uid
      });

      transaction.create(auditRef, {
        action: "leave_opening_balance_created",
        employeeUid: uid,
        openingBalance,
        openingBalanceAsOf,
        performedBy: req.admin.uid,
        performedAt: new Date().toISOString()
      });
    });

    return res.status(201).json({
      success: true,
      message: "Opening leave balance saved successfully."
    });
  } catch (error) {
    if (error.message === "APPROVED_EMPLOYEE_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Approved employee not found."
      });
    }

    if (error.message === "OPENING_BALANCE_ALREADY_EXISTS") {
      return res.status(409).json({
        success: false,
        message: "An opening balance already exists for this employee."
      });
    }

    console.error("Create leave opening balance error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not save the opening leave balance."
    });
  }
});
// List pending employee leave applications.
router.get("/leave-applications/pending", requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection("leaveApplications")
      .where("status", "==", "pending")
      .get();

    const applications = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    applications.sort((a, b) =>
      String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    );

    return res.json({
      success: true,
      applications
    });
  } catch (error) {
    console.error("Pending leave applications error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not load pending leave applications."
    });
  }
});

router.patch("/leave-applications/:id/approve", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid leave application ID."
      });
    }

    const applicationRef = db.collection("leaveApplications").doc(id);
    const transactionRef = db.collection("leaveTransactions")
      .doc(`approval_${id}`);

    await db.runTransaction(async transaction => {
      const applicationSnap = await transaction.get(applicationRef);

      if (!applicationSnap.exists) {
        throw new Error("APPLICATION_NOT_FOUND");
      }

      const application = applicationSnap.data();
      const uid = application.employeeUid;

      if (!uid || application.status !== "pending") {
        throw new Error("APPLICATION_NOT_PENDING");
      }

      const employeeRef = db.collection("employees").doc(uid);
      const balanceRef = db.collection("leaveBalances").doc(uid);
      const lockRef = db.collection("leaveApplicationLocks").doc(uid);

      // Read all documents before performing writes.
      const employeeSnap = await transaction.get(employeeRef);
      const balanceSnap = await transaction.get(balanceRef);
      const lockSnap = await transaction.get(lockRef);
      const deductionSnap = await transaction.get(transactionRef);
      const adjustmentsSnap = await transaction.get(
      db.collection("leaveTransactions")
      .where("employeeUid", "==", uid)
     );

      if (
        !employeeSnap.exists ||
        employeeSnap.data().status !== "approved" ||
        employeeSnap.data().role !== "employee"
      ) {
        throw new Error("EMPLOYEE_NOT_APPROVED");
      }

      if (deductionSnap.exists) {
        throw new Error("DEDUCTION_ALREADY_EXISTS");
      }

      const employee = employeeSnap.data();

      const openingBalance = balanceSnap.exists
        ? balanceSnap.data().openingBalance
        : 0;

      const openingBalanceAsOf = balanceSnap.exists
        ? balanceSnap.data().openingBalanceAsOf
        : null;

      const calculation = calculateAccruedLeaveBalance({
        employmentStartDate: employee.employmentStartDate,
        openingBalance,
        openingBalanceAsOf,
        asOfDate: getNairobiDate()
      });
      let adjustmentTotal = 0;

        for (const doc of adjustmentsSnap.docs) {
      const record = doc.data();

        if (record.type !== "leave_adjustment") {
        continue;
      }

     const days = Number(record.days);

     if (!Number.isFinite(days)) {
      throw new Error("INVALID_LEAVE_ADJUSTMENT");
      }

  adjustmentTotal += days;
}

const adjustedBalance =
  calculation.totalBeforeDeductions + adjustmentTotal;

      const applicationsQuery = db.collection("leaveApplications")
        .where("employeeUid", "==", uid);

      const applicationsSnap = await transaction.get(applicationsQuery);

      let reservedDays = 0;

      for (const doc of applicationsSnap.docs) {
        if (doc.id === id) continue;

        const other = doc.data();

        if (!["pending", "approved"].includes(other.status)) {
          continue;
        }

        if (
          !other.startDate ||
          !other.endDate ||
          other.startDate > other.endDate
        ) {
          throw new Error("INVALID_EXISTING_APPLICATION");
        }

        if (
          application.startDate <= other.endDate &&
          other.startDate <= application.endDate
        ) {
          throw new Error("LEAVE_DATE_OVERLAP");
        }

        const days = Number(
          other.requestedDays ||
          (
            Math.floor(
              (
                new Date(`${other.endDate}T00:00:00.000Z`) -
                new Date(`${other.startDate}T00:00:00.000Z`)
              ) / 86400000
            ) + 1
          )
        );

        if (!Number.isFinite(days) || days <= 0) {
          throw new Error("INVALID_EXISTING_APPLICATION");
        }

        reservedDays += days;
      }

      const requestedDays = Number(application.requestedDays);

      if (
        !application.startDate ||
        !application.endDate ||
        application.startDate > application.endDate ||
        !Number.isFinite(requestedDays) ||
        requestedDays <= 0
      ) {
        throw new Error("INVALID_APPLICATION");
      }

       if (
        requestedDays + reservedDays >
      adjustedBalance + 0.0000001
       ) {
        throw new Error("INSUFFICIENT_LEAVE_BALANCE");
      }

      const now = new Date().toISOString();

      transaction.update(applicationRef, {
        status: "approved",
        approvedAt: now,
        approvedBy: req.admin.uid
      });

      transaction.create(transactionRef, {
        employeeUid: uid,
        applicationId: id,
        type: "leave_deduction",
        days: requestedDays,
        performedBy: req.admin.uid,
        performedAt: now
      });

      // Update the same lock used by employee submissions.
      transaction.set(lockRef, {
        version: lockSnap.exists
          ? Number(lockSnap.data().version || 0) + 1
          : 1,
        updatedAt: now
      }, { merge: true });
    });

    return res.json({
      success: true,
      message: "Leave application approved successfully."
    });

  } catch (error) {
    const errors = {
      APPLICATION_NOT_FOUND: [404, "Leave application not found."],
      APPLICATION_NOT_PENDING: [409, "This application has already been processed."],
      EMPLOYEE_NOT_APPROVED: [409, "The employee is not approved."],
      DEDUCTION_ALREADY_EXISTS: [409, "A deduction already exists for this application."],
      LEAVE_DATE_OVERLAP: [409, "This leave overlaps with another pending or approved application."],
      INSUFFICIENT_LEAVE_BALANCE: [400, "The employee does not have enough leave balance."],
      INVALID_EXISTING_APPLICATION: [409, "An existing leave application has invalid information."],
      INVALID_APPLICATION: [400, "The leave application has invalid dates or requested days."]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];

      return res.status(status).json({
        success: false,
        message
      });
    }

    console.error("Approve leave application error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not approve leave application."
    });
  }
});


// Reject a pending leave application.
router.patch("/leave-applications/:id/reject", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid leave application ID."
      });
    }

    if (
      typeof rejectionReason !== "string" ||
      !rejectionReason.trim() ||
      rejectionReason.trim().length > 1000
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide a rejection reason of up to 1,000 characters."
      });
    }

    const applicationRef = db.collection("leaveApplications").doc(id);
    const auditRef = db.collection("auditLogs").doc();

    await db.runTransaction(async transaction => {
      const applicationSnap = await transaction.get(applicationRef);

      if (!applicationSnap.exists) {
        throw new Error("APPLICATION_NOT_FOUND");
      }

      const application = applicationSnap.data();

      if (application.status !== "pending") {
        throw new Error("APPLICATION_NOT_PENDING");
      }

      const now = new Date().toISOString();

      transaction.update(applicationRef, {
        status: "rejected",
        rejectionReason: rejectionReason.trim(),
        rejectedAt: now,
        rejectedBy: req.admin.uid
      });

      transaction.create(auditRef, {
        action: "leave_application_rejected",
        applicationId: id,
        employeeUid: application.employeeUid,
        rejectionReason: rejectionReason.trim(),
        performedBy: req.admin.uid,
        performedAt: now
      });
    });

    return res.json({
      success: true,
      message: "Leave application rejected successfully."
    });

  } catch (error) {
    const errors = {
      APPLICATION_NOT_FOUND: [404, "Leave application not found."],
      APPLICATION_NOT_PENDING: [409, "This application has already been processed."]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];

      return res.status(status).json({
        success: false,
        message
      });
    }

    console.error("Reject leave application error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not reject leave application."
    });
  }
});

// Adjust an employee's annual leave balance.
router.post("/leave-balances/:uid/adjust", requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const { days, reason } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        message: "Invalid employee ID."
      });
    }

    const adjustmentDays = Number(days);

    if (
      !Number.isFinite(adjustmentDays) ||
      adjustmentDays === 0 ||
      Math.abs(adjustmentDays) > 365
    ) {
      return res.status(400).json({
        success: false,
        message: "Adjustment must be between -365 and 365 days, excluding zero."
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

    const employeeRef = db.collection("employees").doc(uid);
    const balanceRef = db.collection("leaveBalances").doc(uid);
    const lockRef = db.collection("leaveApplicationLocks").doc(uid);
    const adjustmentRef = db.collection("leaveTransactions").doc();
    const auditRef = db.collection("auditLogs").doc();

    await db.runTransaction(async transaction => {
      const employeeSnap = await transaction.get(employeeRef);
      const balanceSnap = await transaction.get(balanceRef);
      const lockSnap = await transaction.get(lockRef);

      const applicationsSnap = await transaction.get(
        db.collection("leaveApplications")
          .where("employeeUid", "==", uid)
      );

      const adjustmentsSnap = await transaction.get(
        db.collection("leaveTransactions")
          .where("employeeUid", "==", uid)
      );

      if (
        !employeeSnap.exists ||
        employeeSnap.data().status !== "approved" ||
        employeeSnap.data().role !== "employee"
      ) {
        throw new Error("EMPLOYEE_NOT_APPROVED");
      }

      const employee = employeeSnap.data();

      const openingBalance = balanceSnap.exists
        ? balanceSnap.data().openingBalance
        : 0;

      const openingBalanceAsOf = balanceSnap.exists
        ? balanceSnap.data().openingBalanceAsOf
        : null;

      const calculation = calculateAccruedLeaveBalance({
        employmentStartDate: employee.employmentStartDate,
        openingBalance,
        openingBalanceAsOf,
        asOfDate: getNairobiDate()
      });

      let existingAdjustments = 0;

      for (const doc of adjustmentsSnap.docs) {
        const record = doc.data();

        if (record.type === "leave_adjustment") {
          const value = Number(record.days);

          if (!Number.isFinite(value)) {
            throw new Error("INVALID_LEAVE_ADJUSTMENT");
          }

          existingAdjustments += value;
        }
      }

      let reservedDays = 0;

      for (const doc of applicationsSnap.docs) {
        const application = doc.data();

        if (!["pending", "approved"].includes(application.status)) {
          continue;
        }

        const requestedDays = Number(application.requestedDays);

        if (!Number.isFinite(requestedDays) || requestedDays <= 0) {
          throw new Error("INVALID_EXISTING_APPLICATION");
        }

        reservedDays += requestedDays;
      }

      const newBalance =
        calculation.totalBeforeDeductions +
        existingAdjustments +
        adjustmentDays;

      if (newBalance + 0.0000001 < reservedDays) {
        throw new Error("ADJUSTMENT_BELOW_RESERVED_BALANCE");
      }

      const now = new Date().toISOString();

      transaction.create(adjustmentRef, {
        employeeUid: uid,
        type: "leave_adjustment",
        days: adjustmentDays,
        reason: reason.trim(),
        performedBy: req.admin.uid,
        performedAt: now
      });

      transaction.create(auditRef, {
        action: "leave_balance_adjusted",
        employeeUid: uid,
        adjustmentDays,
        reason: reason.trim(),
        previousBalance:
          calculation.totalBeforeDeductions + existingAdjustments,
        newBalance,
        performedBy: req.admin.uid,
        performedAt: now
      });

      transaction.set(lockRef, {
        version: (lockSnap.exists
          ? Number(lockSnap.data().version) || 0
          : 0) + 1,
        updatedAt: now
      });
    });

    return res.json({
      success: true,
      message: "Employee leave balance adjusted successfully."
    });

  } catch (error) {
    const errors = {
      EMPLOYEE_NOT_APPROVED: [404, "Approved employee not found."],
      ADJUSTMENT_BELOW_RESERVED_BALANCE: [
        409,
        "This adjustment would reduce the balance below already reserved leave."
      ],
      INVALID_EXISTING_APPLICATION: [
        409,
        "An existing leave application has invalid day values."
      ],
      INVALID_LEAVE_ADJUSTMENT: [
        409,
        "An existing leave adjustment has invalid day values."
      ]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];

      return res.status(status).json({
        success: false,
        message
      });
    }

    console.error("Leave balance adjustment error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Could not adjust employee leave balance."
    });
  }
});

module.exports = router;