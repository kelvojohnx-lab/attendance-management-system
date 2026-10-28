    import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
    import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
    import { firebaseConfig } from "/js/firebase-config.js";

    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const notice = document.getElementById("notice");
    const outletList = document.getElementById("outletList");
    const outletCount = document.getElementById("outletCount");
    let authorized = false;

    function showNotice(text, isError = false) {
      notice.textContent = text;
      notice.style.display = "block";
      notice.style.background = isError ? "#fee2e2" : "#fff4cc";
      notice.style.color = isError ? "#991b1b" : "#795700";
    }

    async function apiRequest(path, options = {}) {
      if (!auth.currentUser) throw new Error("Please sign in again.");

      const token = await auth.currentUser.getIdToken();
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
        throw new Error(result.message || "Request failed.");
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
      outletList.replaceChildren();
      addText(outletList, "p", "Loading outlets…", "muted");

      try {
        const result = await apiRequest("/api/outlets");
        outletList.replaceChildren();
        outletCount.textContent = `(${result.outlets.length})`;

        if (!result.outlets.length) {
          addText(outletList, "p", "No outlets registered yet. Use the form above to add your first outlet.", "muted");
          return;
        }

        for (const outlet of result.outlets) {
          const card = document.createElement("article");
          card.className = "outlet-card";

          addText(card, "h3", outlet.name || "Unnamed outlet");

          const status = addText(
            card, "span",
            outlet.active === false ? "Inactive" : "Active",
            `status${outlet.active === false ? " inactive" : ""}`
          );

          addText(card, "p", outlet.address || "No address provided", "muted");
          addText(card, "p", `Latitude: ${outlet.latitude}`);
          addText(card, "p", `Longitude: ${outlet.longitude}`);
          addText(card, "p", `Attendance radius: ${outlet.radiusMeters || 100} metres`);
          addText(card, "p", `Assigned employees: ${(outlet.employeeIds || []).length}`);

          const actions = document.createElement("div");
          actions.className = "actions";

          const editButton = document.createElement("button");
          editButton.type = "button";
          editButton.className = "secondary";
          editButton.textContent = "Edit details";
          editButton.addEventListener("click", () => editOutlet(outlet));

          const toggleButton = document.createElement("button");
          toggleButton.type = "button";
          toggleButton.className = outlet.active === false ? "" : "danger";
          toggleButton.textContent = outlet.active === false ? "Activate" : "Deactivate";
          toggleButton.addEventListener("click", () => toggleOutlet(outlet));

          actions.append(editButton, toggleButton);
          card.appendChild(actions);
          outletList.appendChild(card);
        }
      } catch (error) {
        outletList.replaceChildren();
        addText(outletList, "p", error.message, "muted");
        showNotice(error.message, true);
      }
    }

    async function editOutlet(outlet) {
      const name = prompt("Outlet name:", outlet.name || "");
      if (name === null) return;

      const address = prompt("Address:", outlet.address || "");
      if (address === null) return;

      const latitudeText = prompt("Latitude:", String(outlet.latitude));
      if (latitudeText === null) return;

      const longitudeText = prompt("Longitude:", String(outlet.longitude));
      if (longitudeText === null) return;

      const latitude = Number(latitudeText);
      const longitude = Number(longitudeText);

      if (!name.trim() || !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) || latitude < -90 ||
          latitude > 90 || longitude < -180 || longitude > 180) {
        showNotice("Please enter a name and valid GPS coordinates.", true);
        return;
      }

      try {
        const result = await apiRequest(
          `/api/outlets/${encodeURIComponent(outlet.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ name, address, latitude, longitude })
          }
        );
        showNotice(result.message);
        await loadOutlets();
      } catch (error) {
        showNotice(error.message, true);
      }
    }

    async function toggleOutlet(outlet) {
      const currentlyActive = outlet.active !== false;
      const action = currentlyActive ? "deactivate" : "activate";

      if (!confirm(`Are you sure you want to ${action} "${outlet.name}"?`)) return;

      try {
        const result = await apiRequest(
          `/api/outlets/${encodeURIComponent(outlet.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ active: !currentlyActive })
          }
        );
        showNotice(result.message);
        await loadOutlets();
      } catch (error) {
        showNotice(error.message, true);
      }
    }

    document.getElementById("outletForm").addEventListener("submit", async event => {
      event.preventDefault();
      if (!authorized) return;

      const button = document.getElementById("createButton");
      button.disabled = true;

      try {
        const payload = {
          name: document.getElementById("outletName").value.trim(),
          address: document.getElementById("outletAddress").value.trim(),
          latitude: Number(document.getElementById("latitude").value),
          longitude: Number(document.getElementById("longitude").value)
        };

        const result = await apiRequest("/api/outlets", {
          method: "POST",
          body: JSON.stringify(payload)
        });

        showNotice(result.message);
        event.target.reset();
        await loadOutlets();
      } catch (error) {
        showNotice(error.message, true);
      } finally {
        button.disabled = false;
      }
    });

    document.getElementById("locationButton").addEventListener("click", () => {
      if (!navigator.geolocation) {
        showNotice("Geolocation is not supported by this browser.", true);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        position => {
          document.getElementById("latitude").value = position.coords.latitude;
          document.getElementById("longitude").value = position.coords.longitude;
          showNotice("GPS coordinates filled in. Confirm you are physically at the outlet before saving.");
        },
        error => showNotice(`Could not get GPS location: ${error.message}`, true),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });

    document.getElementById("refreshButton").addEventListener("click", loadOutlets);

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
          showNotice("Approved administrator access is required.", true);
          await signOut(auth);
          window.location.replace("/login.html");
          return;
        }

        authorized = true;
        await loadOutlets();
        await loadAssignmentPanel();
      } catch (error) {
        showNotice(error.message, true);
      }
    });

const assignmentOutlet = document.getElementById("assignmentOutlet");
const employeeAssignmentList = document.getElementById("employeeAssignmentList");
const assignmentMessage = document.getElementById("assignmentMessage");

let assignmentOutlets = [];
let assignmentEmployees = [];

function showAssignmentMessage(message, isError = false) {
  assignmentMessage.textContent = message;
  assignmentMessage.style.color = isError ? "#991b1b" : "#166534";
}

async function loadAssignmentPanel() {
  assignmentOutlet.replaceChildren();
  employeeAssignmentList.textContent = "Loading employees...";
  assignmentOutlet.add(new Option("Loading outlets...", ""));

  try {
    const [outletResult, employeeResult] = await Promise.all([
      apiRequest("/api/outlets"),
      apiRequest("/api/admin/approved-employees")
    ]);

    assignmentOutlets = outletResult.outlets || [];
    assignmentEmployees = employeeResult.employees || [];

    assignmentOutlet.replaceChildren();

    const activeOutlets = assignmentOutlets.filter(
      outlet => outlet.active !== false
    );

    if (!activeOutlets.length) {
      assignmentOutlet.add(new Option("No active outlets available", ""));
      employeeAssignmentList.textContent =
        "Create or activate an outlet before assigning employees.";
      return;
    }

    for (const outlet of activeOutlets) {
      assignmentOutlet.add(new Option(outlet.name, outlet.id));
    }

    await renderEmployeeAssignments();
  } catch (error) {
    employeeAssignmentList.textContent = error.message;
    showAssignmentMessage(error.message, true);
  }
}

async function renderEmployeeAssignments() {
  const outlet = assignmentOutlets.find(
    item => item.id === assignmentOutlet.value
  );

  employeeAssignmentList.replaceChildren();

  if (!outlet) {
    employeeAssignmentList.textContent = "Select an outlet.";
    return;
  }

  if (!assignmentEmployees.length) {
    employeeAssignmentList.textContent =
      "No approved employees are available for assignment.";
    return;
  }

  const assignedIds = new Set(outlet.employeeIds || []);

  for (const employee of assignmentEmployees) {
    const assigned = assignedIds.has(employee.id);
    const card = document.createElement("article");

    card.className = "outlet-card";
    card.style.marginBottom = "12px";

    const heading = document.createElement("h3");
    heading.textContent = employee.name || "Unnamed employee";

    const details = document.createElement("p");
    details.className = "muted";
    details.textContent =
      `${employee.email || "No email"} · ${employee.phone || "No phone"}`;

    const assignmentDetails = document.createElement("p");
    assignmentDetails.className = "muted";

    const employeeOutletNames = assignmentOutlets
      .filter(item => (employee.outletIds || []).includes(item.id))
      .map(item => item.name);

    assignmentDetails.textContent = employeeOutletNames.length
      ? `Assigned outlets: ${employeeOutletNames.join(", ")}`
      : "Not assigned to any outlet.";

    const status = document.createElement("p");
    status.textContent = assigned
      ? "Assigned to this outlet"
      : "Not assigned to this outlet";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = assigned ? "Remove assignment" : "Assign to outlet";
    button.className = assigned ? "danger" : "";

    button.addEventListener("click", async () => {
      const outletId = assignmentOutlet.value;
      const employeeId = employee.id;
      const action = assigned ? "remove" : "assign";

      if (!confirm(
        `Are you sure you want to ${action} ${employee.name || employee.email} ${
          assigned ? "from" : "to"
        } ${outlet.name}?`
      )) return;

      button.disabled = true;

      try {
        const result = await apiRequest(
          `/api/outlets/${encodeURIComponent(outletId)}/employees/${encodeURIComponent(employeeId)}`,
          { method: assigned ? "DELETE" : "PUT" }
        );

        showAssignmentMessage(result.message || "Assignment updated.");
        await loadAssignmentPanel();
        await loadOutlets();
      } catch (error) {
        showAssignmentMessage(error.message, true);
        button.disabled = false;
      }
    });

    card.append(heading, details, assignmentDetails, status, button);
    employeeAssignmentList.appendChild(card);
  }
}

assignmentOutlet.addEventListener("change", renderEmployeeAssignments);

document.getElementById("refreshAssignmentsButton")
  .addEventListener("click", loadAssignmentPanel);
