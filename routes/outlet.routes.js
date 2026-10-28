const express = require("express");
const { auth, db } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");

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
    const employeeSnap = await db.collection("employees").doc(decoded.uid).get();

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
    console.error("Outlet authorization error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

function validateOutlet(body) {
  const { name, address, latitude, longitude } = body;

  if (typeof name !== "string" || !name.trim()) {
    return "Outlet name is required.";
  }

  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return "Latitude and longitude must be valid numbers.";
  }

  if (address !== undefined && typeof address !== "string") {
    return "Address must be text.";
  }

  return null;
}

// List all outlets.
router.get("/", requireAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection("outlets").orderBy("name").get();

    const outlets = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.json({ success: true, outlets });
  } catch (error) {
    console.error("List outlets error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not load outlets."
    });
  }
});

// Create an outlet.
router.post("/", requireAdmin, async (req, res) => {
  try {
    const validationError = validateOutlet(req.body || {});
    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError
      });
    }

    const { name, address = "", latitude, longitude } = req.body;
    const outletRef = db.collection("outlets").doc();

    const outlet = {
      name: name.trim(),
      address: address.trim(),
      latitude,
      longitude,
      radiusMeters: 100,
      employeeIds: [],
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: req.admin.uid
    };

    await outletRef.set(outlet);

    await db.collection("auditLogs").add({
      action: "outlet_created",
      outletId: outletRef.id,
      performedBy: req.admin.uid,
      createdAt: FieldValue.serverTimestamp()
    });

    return res.status(201).json({
      success: true,
      message: "Outlet created successfully.",
      outlet: { id: outletRef.id, ...outlet, createdAt: null }
    });
  } catch (error) {
    console.error("Create outlet error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not create outlet."
    });
  }
});

// Update an outlet's details or location.
router.patch("/:id", requireAdmin, async (req, res) => {
  try {
    const outletRef = db.collection("outlets").doc(req.params.id);
    const outletSnap = await outletRef.get();

    if (!outletSnap.exists) {
      return res.status(404).json({
        success: false,
        message: "Outlet not found."
      });
    }

    const updates = {};
    const body = req.body || {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Outlet name cannot be empty."
        });
      }
      updates.name = body.name.trim();
    }

    if (body.address !== undefined) {
      if (typeof body.address !== "string") {
        return res.status(400).json({
          success: false,
          message: "Address must be text."
        });
      }
      updates.address = body.address.trim();
    }

    if (body.latitude !== undefined) {
      if (typeof body.latitude !== "number" ||
          !Number.isFinite(body.latitude) ||
          body.latitude < -90 || body.latitude > 90) {
        return res.status(400).json({
          success: false,
          message: "Invalid latitude."
        });
      }
      updates.latitude = body.latitude;
    }

    if (body.longitude !== undefined) {
      if (typeof body.longitude !== "number" ||
          !Number.isFinite(body.longitude) ||
          body.longitude < -180 || body.longitude > 180) {
        return res.status(400).json({
          success: false,
          message: "Invalid longitude."
        });
      }
      updates.longitude = body.longitude;
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "Active must be true or false."
        });
      }
      updates.active = body.active;
    }

    if (body.radiusMeters !== undefined) {
      if (typeof body.radiusMeters !== "number" ||
          !Number.isInteger(body.radiusMeters) ||
          body.radiusMeters < 1 || body.radiusMeters > 100) {
        return res.status(400).json({
          success: false,
          message: "Radius must be an integer from 1 to 100 metres."
        });
      }
      updates.radiusMeters = body.radiusMeters;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one valid field to update."
      });
    }

    updates.updatedAt = FieldValue.serverTimestamp();
    updates.updatedBy = req.admin.uid;

    await outletRef.update(updates);

    await db.collection("auditLogs").add({
      action: "outlet_updated",
      outletId: req.params.id,
      performedBy: req.admin.uid,
      changedFields: Object.keys(updates),
      createdAt: FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      message: "Outlet updated successfully."
    });
  } catch (error) {
    console.error("Update outlet error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not update outlet."
    });
  }
});

// Assign an approved employee to an outlet.
router.put("/:id/employees/:uid", requireAdmin, async (req, res) => {
  try {
    const outletRef = db.collection("outlets").doc(req.params.id);
    const employeeRef = db.collection("employees").doc(req.params.uid);

    await db.runTransaction(async transaction => {
      const outletSnap = await transaction.get(outletRef);
      const employeeSnap = await transaction.get(employeeRef);

      if (!outletSnap.exists) throw new Error("OUTLET_NOT_FOUND");
      if (!employeeSnap.exists) throw new Error("EMPLOYEE_NOT_FOUND");

      const outlet = outletSnap.data();
      const employee = employeeSnap.data();

      if (!outlet.active) throw new Error("OUTLET_INACTIVE");
      if (employee.status !== "approved" || employee.role !== "employee") {
        throw new Error("EMPLOYEE_NOT_APPROVED");
      }

      const employeeIds = outlet.employeeIds || [];
      const outletIds = employee.outletIds || [];

      transaction.update(outletRef, {
        employeeIds: [...new Set([...employeeIds, req.params.uid])],
        updatedAt: FieldValue.serverTimestamp()
      });

      transaction.update(employeeRef, {
        outletIds: [...new Set([...outletIds, req.params.id])],
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    await db.collection("auditLogs").add({
      action: "employee_assigned_to_outlet",
      outletId: req.params.id,
      employeeUid: req.params.uid,
      performedBy: req.admin.uid,
      createdAt: FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      message: "Employee assigned to outlet."
    });
  } catch (error) {
    const knownErrors = {
      OUTLET_NOT_FOUND: [404, "Outlet not found."],
      EMPLOYEE_NOT_FOUND: [404, "Employee not found."],
      OUTLET_INACTIVE: [409, "Cannot assign employees to an inactive outlet."],
      EMPLOYEE_NOT_APPROVED: [409, "Only approved employee accounts can be assigned."]
    };

    if (knownErrors[error.message]) {
      const [status, message] = knownErrors[error.message];
      return res.status(status).json({ success: false, message });
    }

    console.error("Assign employee error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not assign employee."
    });
  }
});

// Remove an employee from an outlet.
router.delete("/:id/employees/:uid", requireAdmin, async (req, res) => {
  try {
    const outletRef = db.collection("outlets").doc(req.params.id);
    const employeeRef = db.collection("employees").doc(req.params.uid);

    await db.runTransaction(async transaction => {
      const outletSnap = await transaction.get(outletRef);
      const employeeSnap = await transaction.get(employeeRef);

      if (!outletSnap.exists) throw new Error("OUTLET_NOT_FOUND");
      if (!employeeSnap.exists) throw new Error("EMPLOYEE_NOT_FOUND");

      transaction.update(outletRef, {
        employeeIds: (outletSnap.data().employeeIds || [])
          .filter(uid => uid !== req.params.uid),
        updatedAt: FieldValue.serverTimestamp()
      });

      transaction.update(employeeRef, {
        outletIds: (employeeSnap.data().outletIds || [])
          .filter(id => id !== req.params.id),
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    await db.collection("auditLogs").add({
      action: "employee_removed_from_outlet",
      outletId: req.params.id,
      employeeUid: req.params.uid,
      performedBy: req.admin.uid,
      createdAt: FieldValue.serverTimestamp()
    });

    return res.json({
      success: true,
      message: "Employee removed from outlet."
    });
  } catch (error) {
    if (["OUTLET_NOT_FOUND", "EMPLOYEE_NOT_FOUND"].includes(error.message)) {
      return res.status(404).json({
        success: false,
        message: error.message === "OUTLET_NOT_FOUND"
          ? "Outlet not found."
          : "Employee not found."
      });
    }

    console.error("Remove employee error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Could not remove employee."
    });
  }
});

module.exports = router;