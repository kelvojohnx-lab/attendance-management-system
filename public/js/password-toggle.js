
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    button.addEventListener("click", () => {
      const inputId = button.dataset.passwordToggle;
      const passwordInput = document.getElementById(inputId);

      if (!passwordInput) return;

      const showPassword = passwordInput.type === "password";

      passwordInput.type = showPassword ? "text" : "password";
      button.textContent = showPassword ? "🙈" : "👁";
      button.setAttribute(
        "aria-label",
        showPassword ? "Hide password" : "Show password"
      );
      button.setAttribute("aria-pressed", String(showPassword));
    });
  });
});
