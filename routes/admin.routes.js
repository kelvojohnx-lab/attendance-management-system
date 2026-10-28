const express = require("express");
const { auth, db } = require("../config/firebase");

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


module.exports = router;