import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const employeeList = document.getElementById("employeeList");
const pendingLeaveList = document.getElementById("pendingLeaveList");
const message = document.getElementById("message");

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

function createCell(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  return cell;
}

// Format dates for display.
function formatDate(dateString) {
  if (!dateString) return "Not recorded";

  const date = new Date(`${dateString}T00:00:00`);

  if (Number.isNaN(date.getTime())) return dateString;

  return date.toLocaleDateString("en-GB");
}

// Load pending leave applications.
async function loadPendingApplications() {
  pendingLeaveList.replaceChildren();

  const loadingRow = document.createElement("tr");
  const loadingCell = createCell("Loading applications...");
  loadingCell.colSpan = 6;
  loadingRow.appendChild(loadingCell);
  pendingLeaveList.appendChild(loadingRow);

  try {
    const result = await apiRequest(
      "/api/admin/leave-applications/pending"
    );

    pendingLeaveList.replaceChildren();

    if (!result.applications.length) {
      const row = document.createElement("tr");
      const cell = createCell("There are no pending leave applications.");
      cell.colSpan = 6;
      row.appendChild(cell);
      pendingLeaveList.appendChild(row);
      return;
    }

    result.applications.forEach(application => {
      const row = document.createElement("tr");

      row.appendChild(
        createCell(application.employeeName || "Unnamed employee")
      );

      row.appendChild(
        createCell(
          `${formatDate(application.startDate)} – ${formatDate(application.endDate)}`
        )
      );

      row.appendChild(
        createCell(`${application.requestedDays} days`)
      );

      const reasonCell = createCell(application.reason || "No reason provided");
      reasonCell.className = "application-reason";
      row.appendChild(reasonCell);

      row.appendChild(
        createCell(formatDate(application.createdAt?.slice(0, 10)))
      );

      const actionCell = document.createElement("td");

      const approveButton = document.createElement("button");
      approveButton.type = "button";
      approveButton.textContent = "Approve";

      approveButton.addEventListener("click", () => {
        processApplication(application, "approve", approveButton, rejectButton);
      });

      const rejectButton = document.createElement("button");
      rejectButton.type = "button";
      rejectButton.textContent = "Reject";
      rejectButton.className = "reject-button";

      rejectButton.addEventListener("click", () => {
        processApplication(application, "reject", approveButton, rejectButton);
      });

      actionCell.append(approveButton, rejectButton);
      row.appendChild(actionCell);

      pendingLeaveList.appendChild(row);
    });

  } catch (error) {
    pendingLeaveList.replaceChildren();

    const row = document.createElement("tr");
    const cell = createCell(error.message);
    cell.colSpan = 6;
    row.appendChild(cell);
    pendingLeaveList.appendChild(row);

    showMessage(error.message, true);
  }
}

// Approve or reject an application.
async function processApplication(
  application,
  action,
  approveButton,
  rejectButton
) {
  let rejectionReason = "";

  if (action === "approve") {
    const confirmed = window.confirm(
      `Approve ${application.employeeName}'s leave application for ${application.requestedDays} days?`
    );

    if (!confirmed) return;
  } else {
    rejectionReason = window.prompt(
      `Enter the reason for rejecting ${application.employeeName}'s leave application:`
    );

    if (rejectionReason === null) return;

    rejectionReason = rejectionReason.trim();

    if (!rejectionReason || rejectionReason.length > 1000) {
      showMessage("Please enter a rejection reason of up to 1,000 characters.", true);
      return;
    }
  }

  approveButton.disabled = true;
  rejectButton.disabled = true;

  try {
    const result = await apiRequest(
      `/api/admin/leave-applications/${encodeURIComponent(application.id)}/${action}`,
      {
        method: "PATCH",
        body: JSON.stringify(
          action === "reject" ? { rejectionReason } : {}
        )
      }
    );

    showMessage(result.message);

    await loadPendingApplications();
  } catch (error) {
    showMessage(error.message, true);
    approveButton.disabled = false;
    rejectButton.disabled = false;
  }
}

// Save an employee's one-time opening balance.
async function saveOpeningBalance(employee, form, button) {
  const formData = new FormData(form);
  const balanceValue = formData.get("openingBalance");
  const openingBalanceAsOf = formData.get("openingBalanceAsOf");

  if (balanceValue === "" || !openingBalanceAsOf) {
    showMessage("Enter both the opening balance and effective date.", true);
    return;
  }

  const openingBalance = Number(balanceValue);

  if (
    !Number.isFinite(openingBalance) ||
    openingBalance < 0 ||
    openingBalance > 365
  ) {
    showMessage("Enter a balance between 0 and 365 days.", true);
    return;
  }

  if (!window.confirm(
    `Save ${openingBalance} leave days for ${employee.name}, effective ${openingBalanceAsOf}? This can only be done once.`
  )) {
    return;
  }

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    const result = await apiRequest(
      `/api/admin/leave-balances/${encodeURIComponent(employee.id)}/opening`,
      {
        method: "POST",
        body: JSON.stringify({
          openingBalance,
          openingBalanceAsOf
        })
      }
    );

    showMessage(result.message);
    await loadEmployees();

  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
    button.textContent = "Save opening balance";
  }
}

// Load approved employees and opening balances.
async function loadEmployees() {
  employeeList.replaceChildren();

  const loadingRow = document.createElement("tr");
  const loadingCell = createCell("Loading employees...");
  loadingCell.colSpan = 5;
  loadingRow.appendChild(loadingCell);
  employeeList.appendChild(loadingRow);

  try {
    const result = await apiRequest("/api/admin/leave-balances");

    employeeList.replaceChildren();

    if (!result.employees.length) {
      const row = document.createElement("tr");
      const cell = createCell("No approved employees found.");
      cell.colSpan = 5;
      row.appendChild(cell);
      employeeList.appendChild(row);
      return;
    }

    result.employees.forEach(employee => {
      const row = document.createElement("tr");

      row.appendChild(createCell(employee.name || "Unnamed employee"));
      row.appendChild(createCell(employee.email || "—"));

      if (employee.initialized) {
        row.appendChild(createCell(`${employee.openingBalance} days`));
        row.appendChild(createCell(employee.openingBalanceAsOf || "Not recorded"));

        const statusCell = document.createElement("td");
        statusCell.textContent = "Opening balance saved";
        statusCell.className = "status-set";

        row.appendChild(statusCell);

      } else {
        const form = document.createElement("form");
        form.id = `balance-form-${employee.id}`;

        const balanceInput = document.createElement("input");
        balanceInput.type = "number";
        balanceInput.name = "openingBalance";
        balanceInput.min = "0";
        balanceInput.max = "365";
        balanceInput.step = "0.01";
        balanceInput.placeholder = "Days";
        balanceInput.required = true;
        balanceInput.setAttribute("form", form.id);

        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.name = "openingBalanceAsOf";
        dateInput.required = true;
        dateInput.setAttribute("form", form.id);

        const saveButton = document.createElement("button");
        saveButton.type = "submit";
        saveButton.textContent = "Save opening balance";

        form.appendChild(saveButton);

        form.addEventListener("submit", event => {
          event.preventDefault();
          saveOpeningBalance(employee, form, saveButton);
        });

        const balanceCell = document.createElement("td");
        balanceCell.appendChild(balanceInput);

        const dateCell = document.createElement("td");
        dateCell.appendChild(dateInput);

        const actionCell = document.createElement("td");
        actionCell.appendChild(form);

        const statusCell = document.createElement("td");
        statusCell.textContent = "Opening balance not set";
        statusCell.className = "status-missing";

        row.append(
          balanceCell,
          dateCell,
          actionCell,
          statusCell
        );
      }

      employeeList.appendChild(row);
    });

  } catch (error) {
    employeeList.replaceChildren();

    const row = document.createElement("tr");
    const cell = createCell(error.message);
    cell.colSpan = 5;
    row.appendChild(cell);
    employeeList.appendChild(row);

    showMessage(error.message, true);
  }
}

// Verify administrator access.
onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  try {
    await user.getIdToken(true);

    const result = await apiRequest("/api/auth/me");

    if (result.role !== "admin" || result.status !== "approved") {
      showMessage("Administrator access required.", true);
      await signOut(auth);
      window.location.replace("/login.html");
      return;
    }

    await Promise.all([
      loadPendingApplications(),
      loadEmployees()
    ]);

  } catch (error) {
    showMessage(error.message, true);
  }
});