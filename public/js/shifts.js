
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { firebaseConfig } from "/js/firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const message = document.getElementById("pageMessage");
const form = document.getElementById("shiftForm");
const outletSelect = document.getElementById("outletIds");
const shiftList = document.getElementById("shiftList");
const saveButton = document.getElementById("saveShiftButton");
const cancelEditButton = document.getElementById("cancelEditButton");

let outlets = [];
let shifts = [];
let editingShiftId = null;
let authorized = false;

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.display = "block";
  message.style.background = isError ? "#fee2e2" : "#fff4cc";
  message.style.color = isError ? "#991b1b" : "#795700";
}

async function apiRequest(path, options = {}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  const token = await user.getIdToken();

  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || "The request failed.");
  }

  return result;
}

function addText(parent, tag, text, className = "") {
  const element = document.createElement(tag);
  element.textContent = text;

  if (className) element.className = className;

  parent.appendChild(element);
  return element;
}

async function loadOutlets() {
  const result = await apiRequest("/api/outlets");

  outlets = result.outlets || [];

  outletSelect.replaceChildren();

  const activeOutlets = outlets.filter(outlet => outlet.active !== false);

  for (const outlet of activeOutlets) {
    outletSelect.add(new Option(outlet.name, outlet.id));
  }

  if (!activeOutlets.length) {
    outletSelect.add(new Option("No active outlets available", ""));
    showMessage("Create or activate an outlet before creating a shift.", true);
  }
}

async function loadShifts() {
  shiftList.textContent = "Loading shifts...";

  try {
    const result = await apiRequest("/api/shifts");
    shifts = result.shifts || [];
    renderShifts();
  } catch (error) {
    shiftList.textContent = error.message;
    showMessage(error.message, true);
  }
}

function formatTime(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return value || "Not set";

  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;

  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function getOutletNames(ids = []) {
  return ids.map(id => {
    const outlet = outlets.find(item => item.id === id);
    return outlet ? outlet.name : "Unknown outlet";
  });
}

function renderShifts() {
  shiftList.replaceChildren();

  if (!shifts.length) {
    shiftList.textContent = "No shifts created yet. Use the form above to create your first shift.";
    return;
  }

  for (const shift of shifts) {
    const card = document.createElement("article");
    card.className = "shift-card";

    addText(card, "h3", shift.name || "Unnamed shift");

    addText(
      card,
      "p",
      `${formatTime(shift.startTime)} – ${formatTime(shift.endTime)}`
    );

    addText(
      card,
      "p",
      `Grace period: ${shift.gracePeriodMinutes ?? 6} minutes`
    );

    const names = getOutletNames(shift.outletIds || []);
    addText(
      card,
      "p",
      `Outlets: ${names.length ? names.join(", ") : "None"}`,
      "muted"
    );

    addText(
      card,
      "p",
      shift.active === false ? "Inactive" : "Active",
      "status"
    );

    const actions = document.createElement("div");
    actions.className = "actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => beginEdit(shift.id));

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = shift.active === false ? "" : "danger";
    toggleButton.textContent =
      shift.active === false ? "Activate" : "Deactivate";

    toggleButton.addEventListener("click", () =>
      toggleShift(shift.id, shift.active !== false)
    );

    actions.append(editButton, toggleButton);
    card.appendChild(actions);
    shiftList.appendChild(card);
  }
}

function beginEdit(id) {
  const shift = shifts.find(item => item.id === id);
  if (!shift) return;

  editingShiftId = id;

  form.elements.name.value = shift.name || "";
  form.elements.startTime.value = shift.startTime || "";
  form.elements.endTime.value = shift.endTime || "";
  form.elements.gracePeriodMinutes.value =
    shift.gracePeriodMinutes ?? 6;

  const selectedIds = new Set(shift.outletIds || []);

  for (const option of outletSelect.options) {
    option.selected = selectedIds.has(option.value);
  }

  document.getElementById("formTitle").textContent = "Edit shift";
  saveButton.textContent = "Update shift";
  cancelEditButton.hidden = false;

  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  editingShiftId = null;
  form.reset();
  form.elements.gracePeriodMinutes.value = 6;

  for (const option of outletSelect.options) {
    option.selected = false;
  }

  document.getElementById("formTitle").textContent = "Create a shift";
  saveButton.textContent = "Save shift";
  cancelEditButton.hidden = true;
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!authorized) {
    showMessage("Administrator authorization is not ready.", true);
    return;
  }

  const name = form.elements.name.value.trim();
  const startTime = form.elements.startTime.value;
  const endTime = form.elements.endTime.value;
  const gracePeriodMinutes = Number(
    form.elements.gracePeriodMinutes.value
  );

  const outletIds = Array.from(outletSelect.selectedOptions)
    .map(option => option.value)
    .filter(Boolean);

  if (!name || !startTime || !endTime || outletIds.length === 0) {
    showMessage("Complete all fields and select at least one outlet.", true);
    return;
  }

  if (
    !Number.isInteger(gracePeriodMinutes) ||
    gracePeriodMinutes < 0 ||
    gracePeriodMinutes > 180
  ) {
    showMessage("Grace period must be between 0 and 180 minutes.", true);
    return;
  }

  const payload = {
    name,
    startTime,
    endTime,
    gracePeriodMinutes,
    outletIds
  };

  saveButton.disabled = true;

  try {
    const result = editingShiftId
      ? await apiRequest(`/api/shifts/${encodeURIComponent(editingShiftId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        })
      : await apiRequest("/api/shifts", {
          method: "POST",
          body: JSON.stringify(payload)
        });

    showMessage(result.message || "Shift saved successfully.");
    resetForm();
    await loadShifts();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
});

async function toggleShift(id, currentlyActive) {
  const action = currentlyActive ? "deactivate" : "activate";

  if (!window.confirm(`Are you sure you want to ${action} this shift?`)) {
    return;
  }

  try {
    const result = await apiRequest(
      `/api/shifts/${encodeURIComponent(id)}/active`,
      {
        method: "PATCH",
        body: JSON.stringify({ active: !currentlyActive })
      }
    );

    showMessage(result.message || "Shift status updated.");
    await loadShifts();
  } catch (error) {
    showMessage(error.message, true);
  }
}

cancelEditButton.addEventListener("click", resetForm);

document.getElementById("refreshShiftsButton").addEventListener("click", async () => {
  try {
    await loadOutlets();
    await loadShifts();
    showMessage("Shift list refreshed.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("/login.html");
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  try {
    await user.getIdToken(true);

    const result = await apiRequest("/api/auth/me");

    if (result.role !== "admin" || result.status !== "approved") {
      showMessage("Approved administrator access is required.", true);
      await signOut(auth);
      window.location.replace("/login.html");
      return;
    }

    authorized = true;

    await loadOutlets();
    await loadShifts();
  } catch (error) {
    showMessage(error.message, true);
  }
});
