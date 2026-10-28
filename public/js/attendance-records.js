
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const message = document.getElementById("message");
const recordsBody = document.getElementById("recordsBody");
const tableInfo = document.getElementById("tableInfo");

let allRecords = [];
let currentRecords = [];
let outletsLoaded = false;
let employeesLoaded = false;

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.display = "block";
  message.style.background = isError ? "#fee2e2" : "#fff4cc";
  message.style.color = isError ? "#991b1b" : "#795700";
}

async function apiRequest(path) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  const token = await user.getIdToken();

  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const result = await response.json();

  if (!response.ok || !result.success) {
    throw new Error(result.message || "The request failed.");
  }

  return result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

function durationBetween(startValue, endValue) {
  if (!startValue || !endValue) return "—";

  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "—";
  }

  const totalMinutes = Math.floor((end - start) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
}

function populateSelect(selectId, values, firstLabel) {
  const select = document.getElementById(selectId);
  const previousValue = select.value;

  select.replaceChildren(new Option(firstLabel, ""));

  for (const item of values) {
    select.add(new Option(item.label, item.value));
  }

  if ([...select.options].some(option => option.value === previousValue)) {
    select.value = previousValue;
  }
}

async function loadFilterOptions() {
  const [outletResult, employeeResult] = await Promise.all([
    apiRequest("/api/outlets"),
    apiRequest("/api/admin/approved-employees")
  ]);

  const outletData = outletResult.outlets || outletResult.data || [];
  const employeeData = employeeResult.employees || employeeResult.data || [];

  populateSelect(
    "outletFilter",
    outletData.map(item => ({
      value: item.id || item.outletId,
      label: item.name || item.outletName || "Unnamed outlet"
    })).filter(item => item.value),
    "All outlets"
  );

  populateSelect(
    "employeeFilter",
    employeeData.map(item => ({
      value: item.uid || item.id,
      label: item.name || item.fullName || item.email || "Unnamed employee"
    })).filter(item => item.value),
    "All employees"
  );

  outletsLoaded = true;
  employeesLoaded = true;
}

function getFilteredRecords() {
  const dateFrom = document.getElementById("dateFrom").value;
  const dateTo = document.getElementById("dateTo").value;
  const outletId = document.getElementById("outletFilter").value;
  const employeeUid = document.getElementById("employeeFilter").value;

  return allRecords.filter(record => {
    if (outletId && record.outletId !== outletId) return false;
    if (employeeUid && record.employeeUid !== employeeUid) return false;

    // The server currently filters dates using UTC calendar dates.
    const clockInDate = record.clockInAt
      ? record.clockInAt.slice(0, 10)
      : "";

    if (dateFrom && (!clockInDate || clockInDate < dateFrom)) return false;
    if (dateTo && (!clockInDate || clockInDate > dateTo)) return false;

    return true;
  });
}

function renderRecords(records) {
  currentRecords = records;

  document.getElementById("recordCount").textContent = records.length;
  document.getElementById("openCount").textContent =
    records.filter(record => record.status === "clocked_in").length;
  document.getElementById("closedCount").textContent =
    records.filter(record => record.status === "clocked_out").length;

  if (!records.length) {
    recordsBody.innerHTML =
      '<tr><td colspan="7">No attendance records match these filters.</td></tr>';
    tableInfo.textContent = "No matching records.";
    return;
  }

  recordsBody.innerHTML = records.map(record => {
    const isOpen = record.status === "clocked_in";

    return `
      <tr>
        <td>${escapeHtml(record.employeeName || "Unknown employee")}</td>
        <td>${escapeHtml(record.outletName || "Unknown outlet")}</td>
        <td>${escapeHtml(record.shiftName || "—")}</td>
        <td>${escapeHtml(formatDate(record.clockInAt))}</td>
        <td>${escapeHtml(formatDate(record.clockOutAt))}</td>
        <td>${escapeHtml(durationBetween(record.clockInAt, record.clockOutAt))}</td>
        <td>
          <span class="status ${isOpen ? "open" : ""}">
            ${isOpen ? "Clocked in" : escapeHtml(record.status)}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  tableInfo.textContent =
    `Showing ${records.length} record(s). Maximum returned by the API: 1,000.`;
}

async function loadRecords() {
  recordsBody.innerHTML =
    '<tr><td colspan="7">Loading attendance records…</td></tr>';
  tableInfo.textContent = "Loading…";

  const result = await apiRequest("/api/admin/attendance-records");
  allRecords = result.records || [];
  renderRecords(getFilteredRecords());
}

function exportCsv() {
  if (!currentRecords.length) {
    showMessage("There are no records to export.", true);
    return;
  }

  const columns = [
    ["Employee", record => record.employeeName],
    ["Employee UID", record => record.employeeUid],
    ["Outlet", record => record.outletName],
    ["Shift", record => record.shiftName],
    ["Clock In", record => record.clockInAt ? formatDate(record.clockInAt) : ""],
    ["Clock Out", record => record.clockOutAt ? formatDate(record.clockOutAt) : ""],
    ["Duration", record => durationBetween(record.clockInAt, record.clockOutAt)],
    ["Status", record => record.status]
  ];

  const csvCell = value => {
    let text = String(value ?? "");

    // Prevent spreadsheet formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  const csv = [
    columns.map(([heading]) => csvCell(heading)).join(","),
    ...currentRecords.map(record =>
      columns.map(([, getter]) => csvCell(getter(record))).join(",")
    )
  ].join("\r\n");

  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `loska-attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById("backButton").addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

document.getElementById("applyFilters").addEventListener("click", () => {
  renderRecords(getFilteredRecords());
});

document.getElementById("resetFilters").addEventListener("click", () => {
  document.getElementById("dateFrom").value = "";
  document.getElementById("dateTo").value = "";
  document.getElementById("outletFilter").value = "";
  document.getElementById("employeeFilter").value = "";
  renderRecords(getFilteredRecords());
});

document.getElementById("refreshRecords").addEventListener("click", async () => {
  try {
    await loadRecords();
    showMessage("Attendance records refreshed.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.getElementById("exportCsv").addEventListener("click", exportCsv);

document.getElementById("outletFilter").addEventListener("change", () => {
  renderRecords(getFilteredRecords());
});

document.getElementById("employeeFilter").addEventListener("change", () => {
  renderRecords(getFilteredRecords());
});

onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.href = "/login.html";
    return;
  }

  try {
    await loadFilterOptions();
    await loadRecords();
  } catch (error) {
    showMessage(error.message, true);
    tableInfo.textContent = "Could not load attendance records.";
    recordsBody.innerHTML =
      '<tr><td colspan="7">Please check the server and try refreshing.</td></tr>';
  }
});
