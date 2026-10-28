
async function checkServer() {
  const status = document.getElementById("status");

  try {
    const response = await fetch("/api/health");

    if (!response.ok) {
      throw new Error("Server returned an error");
    }

    const data = await response.json();
    status.textContent = data.message;
  } catch (error) {
    status.textContent = "Unable to connect to the server.";
    status.style.color = "#b42318";
  }
}

checkServer();
