
const { db } = require("../config/firebase");
const { FieldValue } = require("firebase-admin/firestore");
const {
  validateCoordinates,
  isWithinOutletRadius
} = require("./geolocation.service");

const ATTENDANCE_COLLECTION = "attendance";
function calculateArrivalStatus(startTime, gracePeriodMinutes = 6) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime || "")) {
    throw new Error("The shift start time is invalid.");
  }

  const nairobiTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date());

  const [currentHour, currentMinute] = nairobiTime.split(":").map(Number);
  const [startHour, startMinute] = startTime.split(":").map(Number);

  const currentMinutes = currentHour * 60 + currentMinute;
  const startMinutes = startHour * 60 + startMinute;

  const minutesLate = currentMinutes - startMinutes;

  if (minutesLate <= gracePeriodMinutes) {
    return {
      arrivalStatus: "on_time",
      minutesLate: 0
    };
  }

  return {
    arrivalStatus: "late",
    minutesLate
  };
}

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function validateLocation(location) {
  if (
    !location ||
    !validateCoordinates(location.latitude, location.longitude)
  ) {
    fail("A valid GPS location is required.");
  }

  if (
    typeof location.accuracyMeters !== "number" ||
    !Number.isFinite(location.accuracyMeters) ||
    location.accuracyMeters < 0 ||
    location.accuracyMeters > 100
  ) {
    fail("GPS accuracy is insufficient. Please try again outdoors.");
  }
}

async function getEmployeeOptions(employee) {
  const outletIds = [...new Set(employee.outletIds || [])];

  if (!outletIds.length) {
    return { outlets: [], shifts: [] };
  }

  const outletSnapshots = await Promise.all(
    outletIds.map(id => db.collection("outlets").doc(id).get())
  );

  const outlets = outletSnapshots
    .filter(doc =>
      doc.exists &&
      doc.data().active !== false &&
      (doc.data().employeeIds || []).includes(employee.uid)
    )
    .map(doc => ({
      id: doc.id,
      name: doc.data().name || "",
      address: doc.data().address || "",
      radiusMeters: Math.min(
        100,
        Number.isInteger(doc.data().radiusMeters)
          ? doc.data().radiusMeters
          : 100
      )
    }));

  const validOutletIds = new Set(outlets.map(outlet => outlet.id));

  const shiftSnapshot = await db.collection("shifts")
    .where("active", "==", true)
    .get();

  const shifts = shiftSnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(shift =>
      (shift.outletIds || []).some(id => validOutletIds.has(id))
    )
    .map(shift => ({
      id: shift.id,
      name: shift.name,
      startTime: shift.startTime,
      endTime: shift.endTime,
      outletIds: shift.outletIds.filter(id => validOutletIds.has(id))
    }));

  return { outlets, shifts };
}

async function clockIn({ employee, outletId, shiftId, location }) {
  validateLocation(location);

  const employeeUid = employee.uid;
  const employeeRef = db.collection("employees").doc(employeeUid);
  const outletRef = db.collection("outlets").doc(outletId);
  const shiftRef = db.collection("shifts").doc(shiftId);
  const attendanceRef = db.collection(ATTENDANCE_COLLECTION).doc();

  return db.runTransaction(async transaction => {
    const employeeSnap = await transaction.get(employeeRef);
    const outletSnap = await transaction.get(outletRef);
    const shiftSnap = await transaction.get(shiftRef);

    if (!employeeSnap.exists ||
        employeeSnap.data().status !== "approved" ||
        employeeSnap.data().role !== "employee") {
      fail("Approved employee access is required.", 403);
    }

    if (!outletSnap.exists || outletSnap.data().active === false) {
      fail("This outlet is unavailable.", 400);
    }

    const freshEmployee = employeeSnap.data();
    const outlet = outletSnap.data();

    if (
      !(freshEmployee.outletIds || []).includes(outletId) ||
      !(outlet.employeeIds || []).includes(employeeUid)
    ) {
      fail("You are not assigned to this outlet.", 403);
    }

    if (!shiftSnap.exists || shiftSnap.data().active !== true) {
      fail("Select an active shift.", 400);
    }

    const shift = shiftSnap.data();

    if (!(shift.outletIds || []).includes(outletId)) {
      fail("This shift is not configured for the selected outlet.", 400);
    }

    const distance = isWithinOutletRadius(location, outlet);

    if (!distance || distance.allowed !== true) {
      fail(
        "You are outside the permitted outlet radius or its GPS coordinates are invalid.",
        403
      );
    }

    const openQuery = db.collection(ATTENDANCE_COLLECTION)
      .where("employeeUid", "==", employeeUid)
      .where("status", "==", "clocked_in");

    const openSnapshot = await transaction.get(openQuery);

    if (!openSnapshot.empty) {
      fail("You already have an open attendance session.", 409);
    }
    const arrival = calculateArrivalStatus(
     shift.startTime,
     shift.gracePeriodMinutes ?? 6
  );

    const now = FieldValue.serverTimestamp();

    transaction.set(attendanceRef, {
      employeeUid,
      employeeName: freshEmployee.name || "",
      outletId,
      outletName: outlet.name || "",
      shiftId,
      shiftName: shift.name || "",
      arrivalStatus: arrival.arrivalStatus,
      minutesLate: arrival.minutesLate,
      clockInAt: now,
      clockInLocation: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
        distanceFromOutletMeters: distance.distanceMeters
      },
      status: "clocked_in",
      createdAt: now,
      updatedAt: now
    });

    const auditRef = db.collection("auditLogs").doc();

    transaction.set(auditRef, {
      action: "attendance_clock_in",
      attendanceId: attendanceRef.id,
      employeeUid,
      outletId,
      shiftId,
      createdAt: now
    });

    return {
      id: attendanceRef.id,
      message: "Clock-in recorded successfully.",
      distanceMeters: distance.distanceMeters
    };
  });
}

async function clockOut({ employee, location }) {
  validateLocation(location);

  const employeeUid = employee.uid;

  return db.runTransaction(async transaction => {
    const employeeRef = db.collection("employees").doc(employeeUid);
    const employeeSnap = await transaction.get(employeeRef);

    if (!employeeSnap.exists ||
        employeeSnap.data().status !== "approved" ||
        employeeSnap.data().role !== "employee") {
      fail("Approved employee access is required.", 403);
    }

    const openQuery = db.collection(ATTENDANCE_COLLECTION)
      .where("employeeUid", "==", employeeUid)
      .where("status", "==", "clocked_in");

    const openSnapshot = await transaction.get(openQuery);

    if (openSnapshot.empty) {
      fail("You do not have an open attendance session.", 409);
    }

    if (openSnapshot.size !== 1) {
      fail("Multiple open sessions were found. Contact management.", 409);
    }

    const recordDoc = openSnapshot.docs[0];
    const recordRef = recordDoc.ref;
    const record = recordDoc.data();

    const outletRef = db.collection("outlets").doc(record.outletId);
    const outletSnap = await transaction.get(outletRef);

    if (!outletSnap.exists) {
      fail("The assigned outlet could not be found.", 409);
    }

    const distance = isWithinOutletRadius(location, outletSnap.data());

    if (!distance || distance.allowed !== true) {
      fail(
        "You must be within the permitted outlet radius to clock out.",
        403
      );
    }

    const now = FieldValue.serverTimestamp();

    transaction.update(recordRef, {
      clockOutAt: now,
      clockOutLocation: {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: location.accuracyMeters,
        distanceFromOutletMeters: distance.distanceMeters
      },
      status: "clocked_out",
      updatedAt: now
    });

    const auditRef = db.collection("auditLogs").doc();

    transaction.set(auditRef, {
      action: "attendance_clock_out",
      attendanceId: recordDoc.id,
      employeeUid,
      outletId: record.outletId,
      shiftId: record.shiftId,
      createdAt: now
    });

    return {
      id: recordDoc.id,
      message: "Clock-out recorded successfully.",
      distanceMeters: distance.distanceMeters
    };
  });
}

async function getCurrentAttendance(employeeUid) {
  const snapshot = await db.collection(ATTENDANCE_COLLECTION)
    .where("employeeUid", "==", employeeUid)
    .where("status", "==", "clocked_in")
    .limit(2)
    .get();

  if (snapshot.empty) return null;

  if (snapshot.size > 1) {
    fail("Multiple open sessions were found. Contact management.", 409);
  }

  const doc = snapshot.docs[0];
  const data = doc.data();

  return {
    id: doc.id,
    outletId: data.outletId,
    outletName: data.outletName,
    shiftId: data.shiftId,
    shiftName: data.shiftName,
    clockInAt: data.clockInAt
  };
}

module.exports = {
  getEmployeeOptions,
  clockIn,
  clockOut,
  getCurrentAttendance
};
