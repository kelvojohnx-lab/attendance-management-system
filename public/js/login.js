
import {
  initializeApp,
  getApps
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js";

import { firebaseConfig } from "./firebase-config.js";

const app = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const auth = getAuth(app);

const form = document.getElementById("loginForm");
const message = document.getElementById("message");
const button = document.getElementById("loginButton");

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = type;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  button.disabled = true;
  showMessage("Signing in...");

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );

    const token = await credential.user.getIdToken();

    const response = await fetch("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const result = await response.json();

    if (response.status === 404) {
      showMessage(
        "Your employee profile was not found. Please contact management.",
        "alert-danger"
      );
      await signOut(auth);
      return;
    }

    if (!response.ok) {
      throw new Error(result.message || "Could not verify your account.");
    }

    if (result.status === "pending") {
      showMessage(
        "Your account is awaiting management approval. You can sign in again after approval.",
        "alert-warning"
      );
      await signOut(auth);
      return;
    }

    if (result.status !== "approved") {
      showMessage(
        "Your account is not approved for access. Please contact management.",
        "alert-danger"
      );
      await signOut(auth);
      return;
    }

   if (result.role === "admin") {
  window.location.href = "/dashboard.html";
} else if (result.role === "employee") {
  window.location.href = "/attendance.html";
} else {
  showMessage(
    "Your account role is not recognized. Please contact management.",
    "alert-danger"
  );
  await signOut(auth);
}

  } catch (error) {
    console.error("Sign-in error:", error);

    const messages = {
      "auth/invalid-credential":
        "Incorrect email or password.",
      "auth/user-not-found":
        "No account was found. Check your email or register.",
      "auth/wrong-password":
        "Incorrect email or password.",
      "auth/invalid-email":
        "Please enter a valid email address.",
      "auth/too-many-requests":
        "Too many attempts. Please wait and try again."
    };

    showMessage(
      messages[error.code] ||
      error.message ||
      "Sign-in failed. Please try again.",
      "alert-danger"
    );
  } finally {
    button.disabled = false;
  }
});
