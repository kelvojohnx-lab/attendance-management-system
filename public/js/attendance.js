import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const auth = getAuth(app);

const messageEl = document.getElementById("message");
const statusEl = document.getElementById("attendanceStatus");
const gpsStatusEl = document.getElementById("gpsStatus");
const outletSelect = document.getElementById("outletSelect");
const shiftSelect = document.getElementById("shiftSelect");
const clockInForm = document.getElementById("clockInForm");
const clockInButton = document.getElementById("clockInButton");
const clockOutButton = document.getElementById("clockOutButton");
const clockInCard = document.getElementById("clockInCard");
const clockOutCard = document.getElementById("clockOutCard");
const logoutButton = document.getElementById("logoutButton");

let currentUser = null;
let outlets = [];
let shifts = [];
let currentAttendance = null;

function showMessage(text, type = "info") {
  messageEl.textContent = text;
  messageEl.className = "attendance-message";

  if (type === "success") {
    messageEl.style.background = "var(--success-bg)";
    messageEl.style.color = "var(--success)";
  } else if (type === "error") {
    messageEl.style.background = "var(--danger-bg)";
    messageEl.style.color = "var(--danger)";
  } else {
    messageEl.style.background = "var(--info-bg)";
    messageEl.style.color = "var(--info)";
  }
}

function clearMessage() {
  messageEl.textContent = "";
  messageEl.className = "attendance-message attendance-hidden";
}

async function apiRequest(path, options = {}) {
  if (!currentUser) {
    throw new Error("Please sign in again.");
  }

  const token = await currentUser.getIdToken();

  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      if (result.status === "pending") {
        await signOut(auth);
        window.location.href = "/login.html";
        throw new Error("Your account is not approved for attendance.");
      }
    }

    throw new Error(result.message || "The request failed.");
  }

  return result;
}

function updateShiftOptions() {
  const outletId = outletSelect.value;

  shiftSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = outletId
    ? "Select a shift"
    : "Select an outlet first";
  shiftSelect.appendChild(placeholder);

  const matchingShifts = shifts.filter(shift =>
    (shift.outletIds || []).includes(outletId)
  );

  for (const shift of matchingShifts) {
    const option = document.createElement("option");
    option.value = shift.id;
    option.textContent =
      `${shift.name} (${shift.startTime}–${shift.endTime})`;
    shiftSelect.appendChild(option);
  }

  shiftSelect.disabled = matchingShifts.length === 0;

  if (outletId && matchingShifts.length === 0) {
    showMessage("There are no active shifts configured for this outlet.", "error");
  } else {
    clearMessage();
  }
}

function renderAttendance() {
  if (currentAttendance) {
    statusEl.textContent =
      `You are clocked in at ${currentAttendance.outletName || "your outlet"}` +
      ` on the ${currentAttendance.shiftName || "selected"} shift.`;

    clockInCard.classList.add("attendance-hidden");
    clockOutCard.classList.remove("attendance-hidden");
  } else {
    statusEl.textContent = "You are currently clocked out.";
    clockInCard.classList.remove("attendance-hidden");
    clockOutCard.classList.add("attendance-hidden");
  }
}

async function loadOptions() {
  console.log("Attendance page: loadOptions() started");
  clearMessage();
  statusEl.textContent = "Loading your attendance...";
  clockInButton.disabled = true;
  clockOutButton.disabled = true;

  try {
    const result = await apiRequest("/api/attendance/options");
    console.log("Attendance options response:", result);

    outlets = result.outlets || [];
    shifts = result.shifts || [];
    currentAttendance = result.currentAttendance || null;

    outletSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = outlets.length
      ? "Choose your outlet"
      : "No assigned active outlets";
    outletSelect.appendChild(placeholder);

    for (const outlet of outlets) {
      const option = document.createElement("option");
      option.value = outlet.id;
      option.textContent = outlet.name + (outlet.address ? ` — ${outlet.address}` : "");
      outletSelect.appendChild(option);
    }

    updateShiftOptions();
    renderAttendance();

    if (!outlets.length && !currentAttendance) {
      showMessage(
        "No active outlet is assigned to your account. Contact management.",
        "error"
      );
    }

    if (!shifts.length && outlets.length) {
      showMessage(
        "No active shifts are available for your assigned outlets. Contact management.",
        "error"
      );
    }
  } catch (error) {
    statusEl.textContent = "Could not load attendance.";
    console.error("Failed to load attendance options:", error);
    showMessage(error.message, "error");
  } finally {
    clockInButton.disabled = false;
    clockOutButton.disabled = false;
  }
}

function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser does not support GPS location."));
      return;
    }

    gpsStatusEl.textContent = "Requesting your GPS location…";

    navigator.geolocation.getCurrentPosition(
      position => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy
        };

        if (
          !Number.isFinite(location.accuracyMeters) ||
          location.accuracyMeters > 100
        ) {
          reject(
            new Error(
              `GPS accuracy is about ${Math.round(location.accuracyMeters || 0)} m. ` +
              "Move to an open area, enable precise location, and try again."
            )
          );
          return;
        }

        gpsStatusEl.textContent =
          `GPS obtained. Accuracy: approximately ${Math.round(location.accuracyMeters)} m.`;

        resolve(location);
      },
      error => {
        let text = "Could not obtain your location.";

        if (error.code === error.PERMISSION_DENIED) {
          text = "Location permission was denied. Allow location access in your browser settings.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          text = "GPS location is unavailable. Enable location services and try outdoors.";
        } else if (error.code === error.TIMEOUT) {
          text = "GPS request timed out. Please try again.";
        }

        gpsStatusEl.textContent = text;
        reject(new Error(text));
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  });
}

clockInForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();

  const outletId = outletSelect.value;
  const shiftId = shiftSelect.value;

  if (!outletId || !shiftId) {
    showMessage("Please select both an outlet and a shift.", "error");
    return;
  }

  clockInButton.disabled = true;
  clockInButton.textContent = "Verifying location…";

  try {
    const location = await getCurrentLocation();

    clockInButton.textContent = "Recording clock-in…";

    const result = await apiRequest("/api/attendance/clock-in", {
      method: "POST",
      body: JSON.stringify({
        outletId,
        shiftId,
        ...location
      })
    });

    showMessage(
      `${result.message} Distance from outlet: ${result.distanceMeters} m.`,
      "success"
    );

    await loadOptions();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    clockInButton.disabled = false;
    clockInButton.textContent = "Verify location and clock in";
  }
});

clockOutButton.addEventListener("click", async () => {
  clearMessage();
  clockOutButton.disabled = true;
  clockOutButton.textContent = "Verifying location…";

  try {
    const location = await getCurrentLocation();

    clockOutButton.textContent = "Recording clock-out…";

    const result = await apiRequest("/api/attendance/clock-out", {
      method: "POST",
      body: JSON.stringify(location)
    });

    showMessage(
      `${result.message} Distance from outlet: ${result.distanceMeters} m.`,
      "success"
    );

    await loadOptions();
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    clockOutButton.disabled = false;
    clockOutButton.textContent = "Verify location and clock out";
  }
});

outletSelect.addEventListener("change", updateShiftOptions);

logoutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "/login.html";
  } catch (error) {
    showMessage("Could not sign out. Please try again.", "error");
  }
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  currentUser = user;
  await loadOptions();
});