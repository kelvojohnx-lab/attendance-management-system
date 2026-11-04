import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const message = document.getElementById("message");
const pendingCount = document.getElementById("pendingCount");

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

async function loadPendingEmployees() {
  const container = document.getElementById("approvalList");
  container.textContent = "Loading pending registrations…";

  try {
    const result = await apiRequest("/api/admin/pending-employees");

    pendingCount.textContent = result.employees.length;

    if (result.employees.length === 0) {
      container.textContent = "There are no employees awaiting approval.";
      return;
    }

    container.replaceChildren();

    result.employees.forEach(employee => {
      const card = document.createElement("article");
      card.className = "card";
      card.style.marginTop = "12px";

      const name = document.createElement("h3");
      name.textContent = employee.name || "Name not provided";

      const details = document.createElement("p");
      details.className = "muted";
      details.textContent = `${employee.email} · ${employee.phone}`;

      const approve = document.createElement("button");
      approve.textContent = "Approve";
      approve.addEventListener("click", () =>
        updateEmployee(employee.id, "approve")
      );

      const reject = document.createElement("button");
      reject.textContent = "Reject";
      reject.style.marginLeft = "8px";
      reject.style.background = "#fee2e2";
      reject.addEventListener("click", () =>
        updateEmployee(employee.id, "reject")
      );

      card.append(name, details, approve, reject);
      container.appendChild(card);
    });
  } catch (error) {
    container.textContent = "Unable to load pending registrations.";
    showMessage(error.message, true);
  }
}


async function updateEmployee(uid, action) {
  const verb = action === "approve" ? "approve" : "reject";
  let requestOptions = { method: "PATCH" };

  if (action === "approve") {
    const employmentStartDate = window.prompt(
      "Enter the employee's actual employment start date (YYYY-MM-DD):"
    );

    if (employmentStartDate === null) {
      return;
    }

    const parsedDate = new Date(`${employmentStartDate}T00:00:00Z`);

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(employmentStartDate) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== employmentStartDate
    ) {
      showMessage("Please enter a valid date in YYYY-MM-DD format.", true);
      return;
    }

    requestOptions.body = JSON.stringify({
      employmentStartDate
    });
  } else {
    if (!window.confirm("Are you sure you want to reject this employee?")) {
      return;
    }
  }

  if (
    action === "approve" &&
    !window.confirm(
      `Approve this employee with employment start date ${requestOptions.body ? JSON.parse(requestOptions.body).employmentStartDate : ""}?`
    )
  ) {
    return;
  }

  try {
    const result = await apiRequest(
      `/api/admin/employees/${encodeURIComponent(uid)}/${action}`,
      requestOptions
    );

    showMessage(result.message);
    await loadPendingEmployees();
  } catch (error) {
    showMessage(error.message, true);
  }
}


onAuthStateChanged(auth, async user => {
  if (!user) {
    window.location.replace("/login.html");
    return;
  }

  try {
    // Force-refresh to pick up the administrator claim created by the setup script.
    await user.getIdToken(true);

    const result = await apiRequest("/api/auth/me");

    if (result.role !== "admin" || result.status !== "approved") {
      showMessage("Your administrator access could not be verified.", true);
      await signOut(auth);
      window.location.replace("/login.html");
      return;
    }

    document.getElementById("adminName").textContent =
      result.name || user.email || "Administrator";

    await loadPendingEmployees();
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.getElementById("logoutButton").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("/login.html");
});

document.getElementById("approvalsButton").addEventListener("click", async () => {
  document.getElementById("approvalSection").scrollIntoView({
    behavior: "smooth"
  });
  await loadPendingEmployees();
});

document.getElementById("outletsButton").addEventListener("click", () => {
  window.location.href = "/outlets.html";
});

document.getElementById("attendanceButton").addEventListener("click", () => {
  window.location.href = "/attendance-records.html";
});