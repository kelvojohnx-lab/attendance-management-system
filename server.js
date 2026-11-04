require("dotenv").config();

const { auth, db } = require("./config/firebase");

const express = require("express");
const helmet = require("helmet");
const path = require("path");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const outletRoutes = require("./routes/outlet.routes");
const shiftRoutes = require("./routes/shift.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const leaveRoutes = require("./routes/leave.routes");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  helmet({
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      directives: {
        upgradeInsecureRequests: null,
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://www.gstatic.com",
          "https://www.googleapis.com"
        ],
        connectSrc: [
          "'self'",
          "https://www.gstatic.com",
          "https://identitytoolkit.googleapis.com",
          "https://securetoken.googleapis.com",
          "https://www.googleapis.com",
          "https://firestore.googleapis.com"
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "data:", "https:"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leaveRoutes);
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/outlets", outletRoutes);
app.use("/api/shifts", shiftRoutes);
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Attendance Management System API is running",
    timestamp: new Date().toISOString()
  });
});

app.get("/api", (req, res) => {
  res.json({
    name: "Attendance Management System",
    version: "1.0.0",
    environment: process.env.NODE_ENV || "development"
  });
});
if (process.env.NODE_ENV !== "production") {
  app.get("/api/firebase-check", async (req, res) => {
  try {
    await auth.listUsers(1);
    await db.listCollections();

    res.json({
      success: true,
      message: "Firebase Authentication and Firestore connected successfully"
    });
  } catch (error) {
    console.error("Firebase connection failed:", error);

    res.status(500).json({
      success: false,
      message: "Firebase connection failed. Check server configuration."
    });
  }
});
}
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`Attendance Management System running locally at http://localhost:${PORT}`);
  console.log(`For other devices, use your computer's IPv4 address on port ${PORT}`);
});
