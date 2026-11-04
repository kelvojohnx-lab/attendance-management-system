
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
const balanceEl = document.getElementById("availableBalance");
const balanceDetailsEl = document.getElementById("balanceDetails");
const leaveForm = document.getElementById("leaveForm");
const startDateInput = document.getElementById("startDate");
const endDateInput = document.getElementById("endDate");
const reasonInput = document.getElementById("reason");
const submitButton = document.getElementById("submitButton");
const applicationList = document.getElementById("applicationList");
const logoutButton = document.getElementById("logoutButton");

let currentUser = null;

function todayInNairobi() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};
  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

startDateInput.min = todayInNairobi();
endDateInput.min = todayInNairobi();

function showMessage(message, type = "info") {
  messageEl.textContent = message;
  messageEl.className = "leave-message";

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
  messageEl.className = "leave-message leave-hidden";
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
      }
    }

    throw new Error(result.message || "The request failed.");
  }

  return result;
}

async function loadBalance() {
  balanceEl.textContent = "Loading...";
  balanceDetailsEl.textContent = "";

  try {
    const result = await apiRequest("/api/leave/summary");

    balanceEl.textContent =
      `${formatDays(result.availableBalance)} days`;

    balanceDetailsEl.textContent =
      `Accrued: ${formatDays(result.accruedDays)} days · ` +
      `Opening balance: ${formatDays(result.openingBalance)} days · ` +
      `Approved leave used: ${formatDays(result.approvedLeaveDays)} days · ` +
      `Pending leave reserved: ${formatDays(result.pendingLeaveDays)} days · ` +
      `As of ${result.balanceAsOf}`;

  } catch (error) {
    if (
      error.message.includes("Employment start date is required") ||
      error.message.includes("employment start date")
    ) {
      balanceEl.textContent = "Balance setup pending";

      balanceDetailsEl.textContent =
        "Management will configure your opening leave balance before leave applications become available.";

      return;
    }

    throw error;
  }
}

function createCell(value) {
  const cell = document.createElement("td");
  cell.textContent = value ?? "";
  return cell;
}

async function loadApplications() {
  applicationList.replaceChildren();

  const result = await apiRequest("/api/leave/applications");
  const applications = result.applications || [];

  if (!applications.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = 5;
    cell.textContent = "You have not submitted any leave applications.";

    row.appendChild(cell);
    applicationList.appendChild(row);
    return;
  }

  for (const application of applications) {
    const row = document.createElement("tr");

    row.appendChild(createCell(application.startDate));
    row.appendChild(createCell(application.endDate));
    row.appendChild(createCell(application.requestedDays));
    row.appendChild(createCell(application.reason));

    const statusCell = createCell(application.status);
    statusCell.className = "leave-status";
    row.appendChild(statusCell);

    applicationList.appendChild(row);
  }
}

startDateInput.addEventListener("change", () => {
  endDateInput.min = startDateInput.value || todayInNairobi();

  if (
    endDateInput.value &&
    endDateInput.value < startDateInput.value
  ) {
    endDateInput.value = "";
  }
});

leaveForm.addEventListener("submit", async event => {
  event.preventDefault();
  clearMessage();

  const startDate = startDateInput.value;
  const endDate = endDateInput.value;
  const reason = reasonInput.value.trim();

  if (!startDate || !endDate || !reason) {
    showMessage("Please complete all application fields.", "error");
    return;
  }

  if (endDate < startDate) {
    showMessage("The last day cannot be before the first day.", "error");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting...";

  try {
    const result = await apiRequest("/api/leave/applications", {
      method: "POST",
      body: JSON.stringify({
        startDate,
        endDate,
        reason
      })
    });

    showMessage(result.message, "success");

    leaveForm.reset();
    startDateInput.min = todayInNairobi();
    endDateInput.min = todayInNairobi();

    await Promise.all([
      loadBalance(),
      loadApplications()
    ]);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Submit Leave Application";
  }
});

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

  try {
    const profile = await apiRequest("/api/auth/me");

    if (profile.status !== "approved" || profile.role !== "employee") {
      await signOut(auth);
      window.location.href = "/login.html";
      return;
    }

    await Promise.all([
      loadBalance(),
      loadApplications()
    ]);
  } catch (error) {
    console.error("Leave page loading error:", error);
    showMessage(error.message, "error");
    balanceEl.textContent = "Unavailable";
    applicationList.textContent = "Could not load applications.";
  }
});
