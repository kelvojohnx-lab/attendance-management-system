
import { initializeApp } from
  "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const form = document.getElementById("registerForm");
const message = document.getElementById("message");
const button = document.getElementById("registerButton");
const outletSelect = document.getElementById("requestedOutletId");

// Load active outlets into the registration dropdown.
async function loadOutlets() {
  button.disabled = true;
  outletSelect.disabled = true;
  message.textContent = "Loading available outlets...";

  try {
    const response = await fetch("/api/auth/outlets");
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Could not load outlets.");
    }

    outletSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select your preferred outlet";
    outletSelect.appendChild(placeholder);

    for (const outlet of result.outlets || []) {
      const option = document.createElement("option");
      option.value = outlet.id;
      option.textContent = outlet.address
        ? `${outlet.name} — ${outlet.address}`
        : outlet.name;
      outletSelect.appendChild(option);
    }

    if (!result.outlets || result.outlets.length === 0) {
      message.textContent =
        "No active outlets are available. Please contact management.";
      return;
    }

    outletSelect.disabled = false;
    button.disabled = false;
    message.textContent = "";
  } catch (error) {
    console.error("Loading outlets error:", error);
    message.textContent =
      "Unable to load outlets. Please refresh the page or contact management.";
  }
}

loadOutlets();

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("name").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const requestedOutletId = outletSelect.value;
  const password = document.getElementById("password").value;
  const confirmPassword =
    document.getElementById("confirmPassword").value;

  if (!requestedOutletId) {
    message.textContent = "Please select your preferred outlet.";
    outletSelect.focus();
    return;
  }

  if (password !== confirmPassword) {
    message.textContent = "Passwords do not match.";
    return;
  }

  button.disabled = true;
  message.textContent = "Creating your account...";

  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    const token = await credential.user.getIdToken();

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        name,
        email,
        phone,
        requestedOutletId
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Registration failed.");
    }

    message.textContent =
      "Registration submitted successfully. Your account is awaiting management approval.";

    form.reset();
  } catch (error) {
    console.error("Registration error:", error);

    message.textContent =
      error.code === "auth/email-already-in-use"
        ? "This email already has a Firebase account. Please sign in or contact management."
        : error.code === "auth/weak-password"
        ? "Please choose a stronger password."
        : error.message || "Registration failed. Please try again.";
  } finally {
    button.disabled = false;
  }
});
