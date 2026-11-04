const { db } = require("../config/firebase");

const SHIFTS_COLLECTION = "shifts";

function validateShift(input) {
  const errors = [];

  if (typeof input.name !== "string" || !input.name.trim()) {
    errors.push("Shift name is required.");
  }

  const validTime = value =>
    typeof value === "string" &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  if (!validTime(input.startTime)) {
    errors.push("Start time must use HH:mm format.");
  }

  if (!validTime(input.endTime)) {
    errors.push("End time must use HH:mm format.");
  }

  const grace = input.gracePeriodMinutes ?? 6;

  if (!Number.isInteger(grace) || grace < 0 || grace > 180) {
    errors.push("Grace period must be between 0 and 180 minutes.");
  }

  if (
    !Array.isArray(input.outletIds) ||
    input.outletIds.length === 0 ||
    input.outletIds.some(
      id => typeof id !== "string" || !id.trim()
    )
  ) {
    errors.push("Select at least one valid outlet.");
  }

  return errors;
}

async function getShifts() {
  const snapshot = await db.collection(SHIFTS_COLLECTION).get();

  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

async function getShiftById(id) {
  const doc = await db.collection(SHIFTS_COLLECTION).doc(id).get();

  if (!doc.exists) return null;

  return { id: doc.id, ...doc.data() };
}

async function createShift(input, adminUid) {
  const errors = validateShift(input);

  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.statusCode = 400;
    throw error;
  }

  const outletIds = [...new Set(input.outletIds)];

  const outletChecks = await Promise.all(
    outletIds.map(id => db.collection("outlets").doc(id).get())
  );

  if (outletChecks.some(doc => !doc.exists || doc.data().active === false)) {
    const error = new Error(
      "Every selected outlet must exist and be active."
    );
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();

  const shift = {
    name: input.name.trim(),
    startTime: input.startTime,
    endTime: input.endTime,
    gracePeriodMinutes: input.gracePeriodMinutes ?? 6,
    outletIds,
    active: true,
    createdAt: now,
    createdBy: adminUid,
    updatedAt: now,
    updatedBy: adminUid
  };

  const ref = await db.collection(SHIFTS_COLLECTION).add(shift);

  return { id: ref.id, ...shift };
}

async function updateShift(id, input, adminUid) {
  const existing = await getShiftById(id);

  if (!existing) {
    const error = new Error("Shift not found.");
    error.statusCode = 404;
    throw error;
  }

  const errors = validateShift(input);

  if (errors.length) {
    const error = new Error(errors.join(" "));
    error.statusCode = 400;
    throw error;
  }

  const outletIds = [...new Set(input.outletIds)];

  const outletChecks = await Promise.all(
    outletIds.map(outletId =>
      db.collection("outlets").doc(outletId).get()
    )
  );

  if (outletChecks.some(doc => !doc.exists || doc.data().active === false)) {
    const error = new Error(
      "Every selected outlet must exist and be active."
    );
    error.statusCode = 400;
    throw error;
  }

  const updates = {
    name: input.name.trim(),
    startTime: input.startTime,
    endTime: input.endTime,
    gracePeriodMinutes: input.gracePeriodMinutes ?? 6,
    outletIds,
    updatedAt: new Date(),
    updatedBy: adminUid
  };

  await db.collection(SHIFTS_COLLECTION).doc(id).update(updates);

  return { ...existing, ...updates };
}

async function setShiftActive(id, active, adminUid) {
  if (typeof active !== "boolean") {
    const error = new Error("Active must be true or false.");
    error.statusCode = 400;
    throw error;
  }

  const ref = db.collection(SHIFTS_COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists) {
    const error = new Error("Shift not found.");
    error.statusCode = 404;
    throw error;
  }

  const updates = {
    active,
    updatedAt: new Date(),
    updatedBy: adminUid
  };

  await ref.update(updates);

  return { id, ...doc.data(), ...updates };
}

module.exports = {
  validateShift,
  getShifts,
  getShiftById,
  createShift,
  updateShift,
  setShiftActive
};