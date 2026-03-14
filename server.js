import express from "express";
import cors from "cors";
import sqlite3 from "sqlite3";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import twilio from "twilio";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5000;
const SECRET = process.env.JWT_SECRET || "PRIVATE_DIALER_SECRET";

// Database setup
const db = new sqlite3.Database("./database.db");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    balance REAL DEFAULT 0,
    is_new_user INTEGER DEFAULT 1
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    toNumber TEXT,
    duration INTEGER,
    cost REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Auth Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });
  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ ok: false, error: "Invalid token" });
    req.userId = decoded.id;
    next();
  });
};

// Register
app.post("/api/register", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.json({ ok: false, error: "بيانات ناقصة" });
    const hash = await bcrypt.hash(password, 10);
    db.run(
      "INSERT INTO users (email, password, balance, is_new_user) VALUES (?, ?, 0, 1)",
      [email, hash],
      function (err) {
        if (err) return res.json({ ok: false, error: "المستخدم موجود مسبقاً" });
        res.json({ ok: true });
      }
    );
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Login — grants $1 on first login
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
    if (err || !user) return res.json({ ok: false, error: "المستخدم غير موجود" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.json({ ok: false, error: "كلمة المرور خاطئة" });

    if (user.is_new_user === 1) {
      db.run("UPDATE users SET balance = 1.0, is_new_user = 0 WHERE id = ?", [user.id]);
      user.balance = 1.0;
    }

    const token = jwt.sign({ id: user.id }, SECRET);
    res.json({ ok: true, token, balance: user.balance, uid: user.id });
  });
});

// Get user info
app.get("/api/user", authenticate, (req, res) => {
  db.get("SELECT id, email, balance FROM users WHERE id = ?", [req.userId], (err, user) => {
    if (err || !user) return res.json({ ok: false, error: "User not found" });
    res.json({ ok: true, user });
  });
});

// Call history
app.get("/api/history", authenticate, (req, res) => {
  db.all(
    "SELECT toNumber, cost, timestamp FROM calls WHERE userId = ? ORDER BY timestamp DESC",
    [req.userId],
    (err, rows) => {
      if (err) return res.json({ ok: false, error: err.message });
      res.json({ ok: true, history: rows });
    }
  );
});

// Make a call via Twilio REST
app.post("/api/call", authenticate, (req, res) => {
  const { to } = req.body;
  db.get("SELECT balance FROM users WHERE id = ?", [req.userId], (err, user) => {
    if (err || !user) return res.json({ ok: false, error: "User not found" });
    if (user.balance < 0.05) return res.json({ ok: false, error: "الرصيد غير كافٍ" });

    twilioClient.calls.create({
      to,
      from: process.env.TWILIO_PHONE_NUMBER,
      url: `https://${req.get("host")}/twiml`
    })
      .then(call => {
        db.run("UPDATE users SET balance = balance - 0.05 WHERE id = ?", [req.userId]);
        db.run(
          "INSERT INTO calls (userId, toNumber, cost) VALUES (?, ?, ?)",
          [req.userId, to, 0.05]
        );
        res.json({ ok: true, sid: call.sid });
      })
      .catch(e => res.json({ ok: false, error: e.message }));
  });
});

// TwiML endpoint called by Twilio to handle the call
app.post("/twiml", (req, res) => {
  res.type("text/xml");
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({ callerId: process.env.TWILIO_PHONE_NUMBER });
  dial.number(req.body.To || "");
  res.send(response.toString());
});

// Twilio Access Token for Voice SDK (browser / Capacitor)
app.get("/api/token", authenticate, (req, res) => {
  try {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN,
      { ttl: 3600 }
    );
    token.identity = `user_${req.userId}`;

    const grant = new VoiceGrant({
      outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
      incomingAllow: true
    });
    token.addGrant(grant);

    res.json({ ok: true, token: token.toJwt() });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`✅ Server running on port ${PORT}`));
