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

// Database setup with promise wrapper
const sqlite = sqlite3.verbose();
const db = new sqlite.Database("./database.db");

const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Initialize tables
(async () => {
  try {
    // Drop old tables if they exist (fresh start)
    try {
      await dbRun("DROP TABLE IF EXISTS users");
      await dbRun("DROP TABLE IF EXISTS calls");
    } catch (e) {
      console.log("No old tables to drop");
    }

    // Create fresh tables with correct schema
    await dbRun(`CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 0,
      is_new_user INTEGER DEFAULT 1
    )`);
    
    await dbRun(`CREATE TABLE calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      toNumber TEXT,
      duration INTEGER,
      cost REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log("✅ Database tables created successfully");
  } catch (e) {
    console.error("Database init error:", e);
  }
})();

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
    if (!email || !password) {
      return res.json({ ok: false, error: "بيانات ناقصة" });
    }

    // Check if user already exists
    const existing = await dbGet("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      return res.json({ ok: false, error: "المستخدم موجود مسبقاً" });
    }

    const hash = await bcrypt.hash(password, 10);
    await dbRun(
      "INSERT INTO users (email, password, balance, is_new_user) VALUES (?, ?, 0, 1)",
      [email, hash]
    );
    
    res.json({ ok: true, message: "تم التسجيل بنجاح" });
  } catch (e) {
    console.error("Register error:", e);
    res.json({ ok: false, error: e.message });
  }
});

// Login — grants $1 on first login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({ ok: false, error: "أدخل البريد وكلمة المرور" });
    }

    const user = await dbGet("SELECT * FROM users WHERE email = ?", [email]);
    if (!user) {
      return res.json({ ok: false, error: "المستخدم غير موجود" });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.json({ ok: false, error: "كلمة المرور خاطئة" });
    }

    // Grant $1 on first login
    let balance = user.balance;
    if (user.is_new_user === 1) {
      await dbRun("UPDATE users SET balance = 1.0, is_new_user = 0 WHERE id = ?", [user.id]);
      balance = 1.0;
    }

    const token = jwt.sign({ id: user.id }, SECRET);
    res.json({ ok: true, token, balance, uid: user.id, email: user.email });
  } catch (e) {
    console.error("Login error:", e);
    res.json({ ok: false, error: "حدث خطأ: " + e.message });
  }
});

// Get user info
app.get("/api/user", authenticate, async (req, res) => {
  try {
    const user = await dbGet("SELECT id, email, balance FROM users WHERE id = ?", [req.userId]);
    if (!user) {
      return res.json({ ok: false, error: "User not found" });
    }
    res.json({ ok: true, user });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Call history
app.get("/api/history", authenticate, async (req, res) => {
  try {
    const dbAll = (sql, params = []) => {
      return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
    };

    const history = await dbAll(
      "SELECT toNumber, cost, timestamp FROM calls WHERE userId = ? ORDER BY timestamp DESC LIMIT 50",
      [req.userId]
    );
    res.json({ ok: true, history });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// Make a call via Twilio REST
app.post("/api/call", authenticate, async (req, res) => {
  try {
    const { to } = req.body;
    if (!to) {
      return res.json({ ok: false, error: "Phone number required" });
    }

    const user = await dbGet("SELECT balance FROM users WHERE id = ?", [req.userId]);
    if (!user) {
      return res.json({ ok: false, error: "User not found" });
    }

    const cost = 0.05;
    if (user.balance < cost) {
      return res.json({ ok: false, error: "الرصيد غير كافٍ" });
    }

    try {
      const call = await twilioClient.calls.create({
        to,
        from: process.env.TWILIO_PHONE_NUMBER,
        url: `https://${req.get("host")}/twiml`
      });

      // Deduct balance and log call
      await dbRun("UPDATE users SET balance = balance - ? WHERE id = ?", [cost, req.userId]);
      await dbRun(
        "INSERT INTO calls (userId, toNumber, cost) VALUES (?, ?, ?)",
        [req.userId, to, cost]
      );

      res.json({ ok: true, sid: call.sid });
    } catch (twilioErr) {
      console.error("Twilio error:", twilioErr);
      res.json({ ok: false, error: "Twilio error: " + twilioErr.message });
    }
  } catch (e) {
    console.error("Call error:", e);
    res.json({ ok: false, error: e.message });
  }
});

// TwiML endpoint
app.post("/twiml", (req, res) => {
  res.type("text/xml");
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial({ callerId: process.env.TWILIO_PHONE_NUMBER });
  dial.number(req.body.To || "");
  res.send(response.toString());
});

// Twilio Access Token for Voice SDK
app.get("/api/token", authenticate, async (req, res) => {
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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on port ${PORT}`);
});
