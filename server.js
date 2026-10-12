/**
 * NumberPlus v3 - Digital services store
 * Full rebuild: Express + MySQL, Arabic RTL + English, admin + user panels,
 * OTP via Resend, Cryptomus USDT auto-payments, manual payment methods,
 * balance codes, free offers, tickets, notifications, email broadcast.
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
const axios = require("axios");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

// ---------- Config ----------
const cfg = {
  port: parseInt(process.env.PORT || "8080", 10),
  jwtSecret: process.env.JWT_SECRET || "",
  resendKey: process.env.RESEND_API_KEY || "",
  resendFrom: process.env.RESEND_FROM || process.env.MAIL_FROM || "NumberPlus <info@numberplus.me>",
  adminEmails: (process.env.ADMIN_EMAILS ||
    "sajadem88@gmail.com,saladuu77@gmail.com,shhm98@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  cryptomusKey: process.env.CRYPTOMUS_API_KEY || "",
  cryptomusMerchant: process.env.CRYPTOMUS_MERCHANT_UUID || "",
  cryptomusWebhookSecret: process.env.CRYPTOMUS_WEBHOOK_SECRET || "",
  signupBonus: parseFloat(process.env.SIGNUP_BONUS || "0"),
  signupBonusTarget: process.env.SIGNUP_BONUS_TARGET || "new",
  db: (() => {
    // Support DATABASE_URL (mysql://user:pass@host:port/db)
    if (process.env.DATABASE_URL) {
      try {
        const u = new URL(process.env.DATABASE_URL);
        return {
          host: u.hostname,
          port: parseInt(u.port || "3306", 10),
          user: decodeURIComponent(u.username),
          password: decodeURIComponent(u.password),
          database: u.pathname.replace(/^\//, "") || "numberplus",
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
        };
      } catch (e) {
        console.error("Failed to parse DATABASE_URL:", e.message);
      }
    }
    return {
      host: process.env.DB_HOST || process.env.MYSQLHOST || "localhost",
      port: parseInt(process.env.DB_PORT || process.env.MYSQLPORT || "3306", 10),
      user: process.env.DB_USER || process.env.MYSQLUSER || "root",
      password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "",
      database: process.env.DB_NAME || process.env.MYSQLDATABASE || "numberplus",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    };
  })(),
};

if (!cfg.jwtSecret) {
  console.error("FATAL: JWT_SECRET env var is required. Refusing to boot.");
  process.exit(1);
}

// ---------- DB pool ----------
const pool = mysql.createPool(cfg.db);

async function q(sql, params) {
  const [rows] = await pool.execute(sql, params || []);
  return rows;
}

// ---------- Helpers ----------
const now = () => new Date();
const money = (v) => Number(v || 0).toFixed(2);

function genCustomerId() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function genOrderNumber() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `NP-${stamp}-${rnd}`;
}
function genCode(len) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < (len || 12); i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function genOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
// Unique anime-style SVG avatar, deterministic per seed
function makeAvatar(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (h + 70) % 360;
  const hue3 = (h + 150) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1},70%,55%)"/><stop offset="1" stop-color="hsl(${hue2},70%,45%)"/></linearGradient></defs>` +
    `<circle cx="50" cy="50" r="48" fill="url(#g)"/>` +
    `<circle cx="50" cy="42" r="18" fill="hsl(${hue3},60%,92%)"/>` +
    `<path d="M32 40 q18 -14 36 0 q-4 16 -18 16 q-14 0 -18 -16" fill="hsl(${hue1},60%,30%)"/>` +
    `<circle cx="43" cy="43" r="3" fill="#222"/><circle cx="57" cy="43" r="3" fill="#222"/>` +
    `<path d="M44 52 q6 5 12 0" stroke="#222" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
    `<path d="M20 78 q30 -18 60 0 l0 22 l-60 0 z" fill="hsl(${hue3},50%,35%)" opacity="0.85"/></svg>`;
}

// ---------- Email (Resend HTTP API) ----------
function emailTemplate({ title, bodyHtml, lang }) {
  const dir = lang === "en" ? "ltr" : "rtl";
  const logo = `<div style="text-align:center;margin-bottom:18px">
    <div style="display:inline-block;width:64px;height:64px;border-radius:18px;background:linear-gradient(135deg,#4da6ff,#7b5cff);line-height:64px;color:#fff;font-size:34px;font-weight:800;font-family:Arial">N+</div>
    <div style="font-size:22px;font-weight:800;color:#0b0b13;margin-top:8px;font-family:Arial">NumberPlus</div>
  </div>`;
  return `<!DOCTYPE html><html dir="${dir}"><head><meta charset="utf-8"></head><body style="margin:0;background:#0f1420;font-family:Arial,Tahoma,sans-serif">
  <div style="max-width:520px;margin:30px auto;background:#ffffff;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#0b0b13,#1a2b4a);padding:26px 20px">${logo}</div>
    <div style="padding:28px 26px;color:#1a1a2e">
      <h2 style="margin:0 0 14px;font-size:20px">${title}</h2>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #eee;margin:22px 0">
      <div style="font-size:12px;color:#888;text-align:center">
        <div style="margin-bottom:8px">NumberPlus &mdash; <a href="https://numberplus.me" style="color:#4da6ff">numberplus.me</a></div>
        <div>&copy; ${new Date().getFullYear()} NumberPlus. All rights reserved. / جميع الحقوق محفوظة</div>
      </div>
    </div>
  </div></body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!cfg.resendKey) {
    console.log(`[email:dev] to=${to} subject=${subject} (no RESEND_API_KEY, logged only)`);
    return { ok: true, dev: true };
  }
  try {
    const r = await axios.post("https://api.resend.com/emails", {
      from: cfg.resendFrom, to: [to], subject, html,
    }, { headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json" }, timeout: 15000 });
    return { ok: true, id: r.data && r.data.id };
  } catch (e) {
    console.error("[email] Resend error:", (e.response && e.response.data) || e.message);
    return { ok: false, error: "email_failed" };
  }
}

async function sendOtpEmail(to, code, lang) {
  const ar = lang !== "en";
  const title = ar ? "رمز التحقق الخاص بك" : "Your verification code";
  const body = ar
    ? `<p style="font-size:15px">مرحباً بك في <b>NumberPlus</b>! استخدم الرمز التالي لإكمال التسجيل:</p>
       <div style="text-align:center;margin:20px 0"><span dir="ltr" style="display:inline-block;font-size:38px;font-weight:800;letter-spacing:10px;color:#0b0b13;background:#eef4ff;border:2px dashed #4da6ff;border-radius:12px;padding:12px 26px">${code}</span></div>
       <p style="font-size:13px;color:#666">صالح لمدة 10 دقائق. إذا لم تطلب هذا الرمز تجاهل هذه الرسالة.</p>`
    : `<p style="font-size:15px">Welcome to <b>NumberPlus</b>! Use this code to complete registration:</p>
       <div style="text-align:center;margin:20px 0"><span dir="ltr" style="display:inline-block;font-size:38px;font-weight:800;letter-spacing:10px;color:#0b0b13;background:#eef4ff;border:2px dashed #4da6ff;border-radius:12px;padding:12px 26px">${code}</span></div>
       <p style="font-size:13px;color:#666">Valid for 10 minutes. If you didn't request this, ignore this message.</p>`;
  return sendEmail(to, ar ? `رمز التحقق من NumberPlus: ${code}` : `Your NumberPlus verification code: ${code}`,
    emailTemplate({ title, bodyHtml: body, lang }));
}

// ---------- Schema ----------
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(60) UNIQUE NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  whatsapp VARCHAR(40) NULL,
  customer_id VARCHAR(6) UNIQUE NOT NULL,
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  avatar_svg TEXT NULL,
  banned TINYINT(1) NOT NULL DEFAULT 0,
  language VARCHAR(5) NOT NULL DEFAULT 'ar',
  theme VARCHAR(30) NOT NULL DEFAULT 'dark-blue',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email), INDEX idx_customer (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  name_en VARCHAR(160) NULL,
  description TEXT NULL,
  description_en TEXT NULL,
  category VARCHAR(60) NOT NULL,
  subcategory VARCHAR(60) NULL,
  price DECIMAL(12,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  max_per_user INT NOT NULL DEFAULT 0,
  requires_link TINYINT(1) NOT NULL DEFAULT 0,
  requires_number TINYINT(1) NOT NULL DEFAULT 0,
  logo_url VARCHAR(500) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  is_free TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cat (category, subcategory), INDEX idx_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_number VARCHAR(24) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  total_price DECIMAL(12,2) NOT NULL,
  status ENUM('pending','processing','completed','cancelled') NOT NULL DEFAULT 'pending',
  link_value VARCHAR(500) NULL,
  number_value VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id), INDEX idx_status (status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_email_code (email, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS balance_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(24) UNIQUE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  used_by INT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS tickets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  subject VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('open','answered','closed') NOT NULL DEFAULT 'open',
  admin_reply TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tuser (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS payment_methods (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  type ENUM('cryptomus','manual') NOT NULL DEFAULT 'manual',
  config JSON NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  \`key\` VARCHAR(80) UNIQUE NOT NULL,
  \`value\` TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('charge','purchase','refund','bonus','redeem') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(60) NULL,
  status ENUM('pending','completed','failed') NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tuser2 (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function initDb() {
  const statements = SCHEMA.split(/;\s*\n/).filter((s) => s.trim());
  for (const st of statements) await pool.query(st);
  // seed default settings
  const defaults = [
    ["support_email", "info@numberplus.me"],
    ["support_whatsapp", ""],
    ["support_telegram", ""],
    ["social_links", JSON.stringify({})],
  ];
  for (const [k, v] of defaults) {
    await pool.query("INSERT IGNORE INTO settings (`key`, `value`) VALUES (?, ?)", [k, v]);
  }
  // seed 3 lawful products
  const count = await q("SELECT COUNT(*) AS c FROM products");
  if (Number(count[0].c) === 0) {
    const seed = [
      ["رقم واتساب جاهز", "Ready WhatsApp Number", "رقم واتساب مفعّل وجاهز للاستخدام الفوري مع ضمان الاستبدال.", "whatsapp", "numbers", 2.50, 100, 5],
      ["رقم تيليجرام", "Telegram Number", "رقم تيليجرام مفعّل لتفعيل الحسابات والبوتات.", "telegram", "numbers", 1.75, 100, 5],
      ["اشتراك بريميوم شهري", "Monthly Premium Subscription", "اشتراك بريميوم شهري لأشهر التطبيقات — تفعيل سريع ودعم متواصل.", "premium", "subscriptions", 4.99, 50, 2],
    ];
    for (const [name, nameEn, desc, cat, sub, price, stock, maxu] of seed) {
      await q(
        "INSERT INTO products (name, name_en, description, category, subcategory, price, stock, max_per_user, active) VALUES (?,?,?,?,?,?,?,?,1)",
        [name, nameEn, desc, cat, sub, price, stock, maxu]
      );
    }
  }
}

// ---------- Auth ----------
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, cfg.jwtSecret, { expiresIn: "30d" });
}
async function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : (req.cookies.np_token || "");
  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const p = jwt.verify(token, cfg.jwtSecret);
    const rows = await q("SELECT id, username, email, full_name, whatsapp, customer_id, balance, role, avatar_svg, banned, language, theme FROM users WHERE id=?", [p.id]);
    if (!rows.length) return res.status(401).json({ error: "unauthorized" });
    if (rows[0].banned) return res.status(403).json({ error: "banned" });
    req.user = rows[0];
    next();
  } catch (e) { return res.status(401).json({ error: "unauthorized" }); }
}
function admin(req, res, next) {
  if (req.user && req.user.role === "admin") return next();
  return res.status(403).json({ error: "forbidden" });
}
async function maybePromote(email) {
  const em = String(email).trim().toLowerCase();
  if (cfg.adminEmails.includes(em)) {
    await q("UPDATE users SET role='admin' WHERE LOWER(email)=?", [em]);
  }
}
const isGmail = (e) => /^[a-zA-Z0-9._%+-]+@gmail\.com$/i.test(String(e).trim());

// ---------- Routes ----------
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ---------- Auth routes ----------
// Register: fullName, email (gmail only), username, password -> sends OTP
app.post("/api/auth/register", async (req, res) => {
  try {
    const { fullName, email, username, password, lang } = req.body || {};
    if (!fullName || !email || !username || !password)
      return res.status(400).json({ error: "missing_fields" });
    const em = String(email).trim().toLowerCase();
    if (!isGmail(em)) return res.status(400).json({ error: "gmail_only" });
    if (String(password).length < 6) return res.status(400).json({ error: "password_short" });
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(String(username)))
      return res.status(400).json({ error: "bad_username" });
    const exists = await q("SELECT id FROM users WHERE email=? OR username=?", [em, String(username).trim()]);
    if (exists.length) return res.status(409).json({ error: "exists" });
    // generate unique 6-digit customer id up front
    let cid = genCustomerId();
    for (let i = 0; i < 8; i++) {
      const c = await q("SELECT id FROM users WHERE customer_id=?", [cid]);
      if (!c.length) break;
      cid = genCustomerId();
    }
    // banned=1 keeps the account pending until OTP verification
    await q("INSERT INTO users (username, email, password_hash, full_name, customer_id, role, banned, avatar_svg) VALUES (?,?,?,?,?,'user',1,?)",
      [String(username).trim(), em, await bcrypt.hash(String(password), 10), String(fullName).trim(), cid, makeAvatar(em)]);
    const uid = (await q("SELECT id FROM users WHERE email=?", [em]))[0].id;
    const code = genOtp();
    await q("DELETE FROM otp_codes WHERE email=?", [em]);
    await q("INSERT INTO otp_codes (email, code, expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 10 MINUTE))", [em, code]);
    const sent = await sendOtpEmail(em, code, lang);
    // mark pending: banned=1 until verified
    return res.json({ ok: true, userId: uid, emailSent: sent.ok });
  } catch (e) { console.error(e); return res.status(500).json({ error: "server_error" }); }
});

// Verify OTP -> finalize account: customer_id, avatar, unban, signup bonus, JWT
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    const rows = await q("SELECT * FROM otp_codes WHERE email=? AND code=? AND used=0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1", [em, String(otp || "").trim()]);
    if (!rows.length) return res.status(400).json({ error: "bad_otp" });
    await q("UPDATE otp_codes SET used=1 WHERE id=?", [rows[0].id]);
    const users = await q("SELECT * FROM users WHERE email=?", [em]);
    if (!users.length) return res.status(404).json({ error: "not_found" });
    const u = users[0];
    // finalize: unban the pending account (customer_id + avatar were set at register)
    await q("UPDATE users SET banned=0 WHERE id=?", [u.id]);
    await maybePromote(em);
    // signup bonus
    if (cfg.signupBonus > 0) {
      const target = cfg.signupBonusTarget || "new";
      const apply = target === "all" || target === "new";
      if (apply) {
        await q("UPDATE users SET balance = balance + ? WHERE id=?", [cfg.signupBonus, u.id]);
        await q("INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?,?,?,'bonus','completed')", [u.id, "bonus", cfg.signupBonus]);
      }
    }
    const fresh = (await q("SELECT id, username, email, full_name, whatsapp, customer_id, balance, role, avatar_svg, language, theme FROM users WHERE id=?", [u.id]))[0];
    return res.json({ ok: true, token: signToken(fresh), user: fresh });
  } catch (e) { console.error(e); return res.status(500).json({ error: "server_error" }); }
});

// Login: identifier = email | username | customer_id
app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};
    const idn = String(identifier || "").trim();
    if (!idn || !password) return res.status(400).json({ error: "missing_fields" });
    const rows = await q("SELECT * FROM users WHERE email=? OR username=? OR customer_id=?", [idn.toLowerCase(), idn, idn]);
    if (!rows.length) return res.status(401).json({ error: "bad_credentials" });
    const u = rows[0];
    if (u.banned) return res.status(403).json({ error: "banned" });
    const ok = await bcrypt.compare(String(password), u.password_hash);
    if (!ok) return res.status(401).json({ error: "bad_credentials" });
    await maybePromote(u.email);
    const fresh = (await q("SELECT id, username, email, full_name, whatsapp, customer_id, balance, role, avatar_svg, language, theme FROM users WHERE id=?", [u.id]))[0];
    // frontend performs OTP after login for privacy: issue a one-time login OTP
    const code = genOtp();
    await q("DELETE FROM otp_codes WHERE email=?", [fresh.email]);
    await q("INSERT INTO otp_codes (email, code, expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 10 MINUTE))", [fresh.email, code]);
    const sent = await sendOtpEmail(fresh.email, code, fresh.language);
    return res.json({ ok: true, needOtp: true, email: fresh.email, emailSent: sent.ok });
  } catch (e) { console.error(e); return res.status(500).json({ error: "server_error" }); }
});

// Confirm login OTP -> JWT
app.post("/api/auth/login-otp", async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    const rows = await q("SELECT * FROM otp_codes WHERE email=? AND code=? AND used=0 AND expires_at > NOW() ORDER BY id DESC LIMIT 1", [em, String(otp || "").trim()]);
    if (!rows.length) return res.status(400).json({ error: "bad_otp" });
    await q("UPDATE otp_codes SET used=1 WHERE id=?", [rows[0].id]);
    const users = await q("SELECT id, username, email, full_name, whatsapp, customer_id, balance, role, avatar_svg, language, theme, banned FROM users WHERE email=?", [em]);
    if (!users.length || users[0].banned) return res.status(403).json({ error: "banned" });
    const u = users[0];
    delete u.banned;
    return res.json({ ok: true, token: signToken(u), user: u });
  } catch (e) { console.error(e); return res.status(500).json({ error: "server_error" }); }
});

// ---------- Products ----------
app.get("/api/products", async (req, res) => {
  try {
    const rows = await q("SELECT id, name, name_en, description, description_en, category, subcategory, price, stock, max_per_user, requires_link, requires_number, logo_url, is_free FROM products WHERE active=1 ORDER BY id DESC");
    res.json({ ok: true, products: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.get("/api/products/:category", async (req, res) => {
  try {
    const rows = await q("SELECT id, name, name_en, description, description_en, category, subcategory, price, stock, max_per_user, requires_link, requires_number, logo_url, is_free FROM products WHERE active=1 AND category=? ORDER BY id DESC", [req.params.category]);
    res.json({ ok: true, products: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.get("/api/products/:category/:subcategory", async (req, res) => {
  try {
    const rows = await q("SELECT id, name, name_en, description, description_en, category, subcategory, price, stock, max_per_user, requires_link, requires_number, logo_url, is_free FROM products WHERE active=1 AND category=? AND subcategory=? ORDER BY id DESC", [req.params.category, req.params.subcategory]);
    res.json({ ok: true, products: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ---------- Orders (user) ----------
app.post("/api/orders", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { productId, quantity, linkValue, numberValue } = req.body || {};
    const qty = Math.max(1, parseInt(quantity || "1", 10));
    await conn.beginTransaction();
    const [prows] = await conn.execute("SELECT * FROM products WHERE id=? AND active=1 FOR UPDATE", [productId]);
    if (!prows.length) { await conn.rollback(); return res.status(404).json({ error: "product_not_found" }); }
    const p = prows[0];
    if (Number(p.stock) < qty) { await conn.rollback(); return res.status(400).json({ error: "out_of_stock" }); }
    if (Number(p.max_per_user) > 0) {
      const [bought] = await conn.execute("SELECT COALESCE(SUM(quantity),0) AS s FROM orders WHERE user_id=? AND product_id=? AND status != 'cancelled'", [req.user.id, p.id]);
      if (Number(bought[0].s) + qty > Number(p.max_per_user)) { await conn.rollback(); return res.status(400).json({ error: "max_per_user" }); }
    }
    if (p.requires_link && !linkValue) { await conn.rollback(); return res.status(400).json({ error: "link_required" }); }
    if (p.requires_number && !numberValue) { await conn.rollback(); return res.status(400).json({ error: "number_required" }); }
    const total = Number(p.price) * qty;
    const [urows] = await conn.execute("SELECT balance FROM users WHERE id=? FOR UPDATE", [req.user.id]);
    if (Number(urows[0].balance) < total) { await conn.rollback(); return res.status(400).json({ error: "insufficient_balance" }); }
    await conn.execute("UPDATE users SET balance = balance - ? WHERE id=?", [total, req.user.id]);
    await conn.execute("UPDATE products SET stock = stock - ? WHERE id=?", [qty, p.id]);
    const orderNo = genOrderNumber();
    await conn.execute(
      "INSERT INTO orders (order_number, user_id, product_id, quantity, total_price, status, link_value, number_value) VALUES (?,?,?,?,?,'pending',?,?)",
      [orderNo, req.user.id, p.id, qty, total, linkValue || null, numberValue || null]
    );
    await conn.execute("INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?, 'purchase', ?, 'balance', 'completed')", [req.user.id, total]);
    await conn.commit();
    res.json({ ok: true, orderNumber: orderNo });
  } catch (e) { try { await conn.rollback(); } catch (_) {} console.error(e); res.status(500).json({ error: "server_error" }); }
  finally { conn.release(); }
});
app.get("/api/orders", auth, async (req, res) => {
  try {
    const rows = await q("SELECT o.*, p.name AS product_name FROM orders o JOIN products p ON p.id=o.product_id WHERE o.user_id=? ORDER BY o.id DESC", [req.user.id]);
    res.json({ ok: true, orders: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.get("/api/user/profile", auth, async (req, res) => {
  try {
    const stats = await q("SELECT COUNT(*) AS orders, COALESCE(SUM(total_price),0) AS spent FROM orders WHERE user_id=? AND status != 'cancelled'", [req.user.id]);
    res.json({ ok: true, user: req.user, stats: stats[0] });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ---------- Balance ----------
app.post("/api/balance/redeem", auth, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ error: "missing_code" });
    await conn.beginTransaction();
    const [rows] = await conn.execute("SELECT * FROM balance_codes WHERE code=? FOR UPDATE", [code]);
    if (!rows.length || rows[0].used_by) { await conn.rollback(); return res.status(400).json({ error: "invalid_code" }); }
    await conn.execute("UPDATE balance_codes SET used_by=?, used_at=NOW() WHERE id=?", [req.user.id, rows[0].id]);
    await conn.execute("UPDATE users SET balance = balance + ? WHERE id=?", [rows[0].amount, req.user.id]);
    await conn.execute("INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?, 'redeem', ?, 'code', 'completed')", [req.user.id, rows[0].amount]);
    await conn.commit();
    res.json({ ok: true, amount: rows[0].amount });
  } catch (e) { try { await conn.rollback(); } catch (_) {} console.error(e); res.status(500).json({ error: "server_error" }); }
  finally { conn.release(); }
});

// ---------- Cryptomus (USDT automatic) ----------
function cryptomusSign(payload) {
  return crypto.createHash("md5").update(Buffer.from(JSON.stringify(payload)).toString("base64") + cfg.cryptomusKey).digest("hex");
}
app.post("/api/payment/cryptomus/create", auth, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    if (!amount || amount < 1) return res.status(400).json({ error: "bad_amount" });
    if (!cfg.cryptomusKey || !cfg.cryptomusMerchant)
      return res.status(503).json({ error: "cryptomus_not_configured" });
    const payload = {
      amount: amount.toFixed(2), currency: "USD", order_id: `BAL-${req.user.id}-${Date.now()}`,
      url_callback: `${req.protocol}://${req.get("host")}/api/payment/cryptomus/webhook`,
      is_payment_multiple: false, lifetime: 3600,
    };
    const r = await axios.post("https://api.cryptomus.com/v1/payment/create", payload, {
      headers: { merchant: cfg.cryptomusMerchant, sign: cryptomusSign(payload), "Content-Type": "application/json" },
      timeout: 20000,
    });
    const d = r.data && r.data.result;
    if (!d || !d.url) return res.status(502).json({ error: "cryptomus_error" });
    await q("INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?, 'charge', ?, 'cryptomus', 'pending')", [req.user.id, amount]);
    res.json({ ok: true, url: d.url, uuid: d.uuid });
  } catch (e) { console.error("[cryptomus]", (e.response && e.response.data) || e.message); res.status(502).json({ error: "cryptomus_error" }); }
});
app.post("/api/payment/cryptomus/webhook", express.json(), async (req, res) => {
  try {
    const body = req.body || {};
    const sign = req.headers["sign"];
    const calc = crypto.createHash("md5").update(Buffer.from(JSON.stringify(body)).toString("base64") + cfg.cryptomusKey).digest("hex");
    if (cfg.cryptomusWebhookSecret && sign !== calc) return res.status(403).json({ error: "bad_sign" });
    const { order_id, status, amount } = body;
    if (status === "paid" || status === "paid_over") {
      const m = /^BAL-(\d+)-/.exec(String(order_id || ""));
      if (m) {
        const uid = parseInt(m[1], 10);
        const amt = Number(amount);
        await q("UPDATE users SET balance = balance + ? WHERE id=?", [amt, uid]);
        await q("UPDATE transactions SET status='completed' WHERE user_id=? AND method='cryptomus' AND status='pending' ORDER BY id DESC LIMIT 1", [uid]);
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ---------- Payment methods (public list) ----------
app.get("/api/payment/methods", async (req, res) => {
  try {
    const rows = await q("SELECT id, name, type, config, active FROM payment_methods WHERE active=1");
    res.json({ ok: true, methods: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ---------- Tickets (user) ----------
app.post("/api/tickets", auth, async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ error: "missing_fields" });
    await q("INSERT INTO tickets (user_id, subject, message) VALUES (?,?,?)", [req.user.id, String(subject).slice(0, 200), String(message).slice(0, 5000)]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.get("/api/tickets", auth, async (req, res) => {
  try {
    const rows = await q("SELECT id, subject, message, status, admin_reply, created_at FROM tickets WHERE user_id=? ORDER BY id DESC", [req.user.id]);
    res.json({ ok: true, tickets: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ---------- Notifications (public feed) ----------
app.get("/api/notifications", async (req, res) => {
  try {
    const rows = await q("SELECT id, title, message, created_at FROM notifications ORDER BY id DESC LIMIT 20");
    res.json({ ok: true, notifications: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ================= ADMIN =================
app.get("/api/admin/stats", auth, admin, async (req, res) => {
  try {
    const [u] = await q("SELECT COUNT(*) c, COALESCE(SUM(balance),0) b FROM users");
    const [o] = await q("SELECT COUNT(*) c, COALESCE(SUM(total_price),0) s FROM orders WHERE status != 'cancelled'");
    const [p] = await q("SELECT COUNT(*) c FROM products WHERE active=1");
    const [t] = await q("SELECT COUNT(*) c FROM tickets WHERE status='open'");
    res.json({ ok: true, stats: { users: u.c, totalBalance: u.b, orders: o.c, sales: o.s, products: p.c, openTickets: t.c } });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// Products CRUD
app.get("/api/admin/products", auth, admin, async (req, res) => {
  try { const rows = await q("SELECT * FROM products ORDER BY id DESC"); res.json({ ok: true, products: rows }); }
  catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/products", auth, admin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || b.price == null) return res.status(400).json({ error: "missing_fields" });
    const price = Number(b.price);
    if (!(price >= 0.05 && price <= 10000)) return res.status(400).json({ error: "price_range" });
    await q(`INSERT INTO products (name, name_en, description, description_en, category, subcategory, price, stock, max_per_user, requires_link, requires_number, logo_url, active, is_free)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [b.name, b.name_en || null, b.description || null, b.description_en || null, b.category || "general", b.subcategory || null,
       price, parseInt(b.stock || "0", 10), parseInt(b.max_per_user || "0", 10),
       b.requires_link ? 1 : 0, b.requires_number ? 1 : 0, b.logo_url || null, b.active === false ? 0 : 1, b.is_free ? 1 : 0]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.put("/api/admin/products/:id", auth, admin, async (req, res) => {
  try {
    const b = req.body || {};
    const price = Number(b.price);
    if (b.price != null && !(price >= 0.05 && price <= 10000)) return res.status(400).json({ error: "price_range" });
    await q(`UPDATE products SET name=?, name_en=?, description=?, description_en=?, category=?, subcategory=?, price=?, stock=?, max_per_user=?, requires_link=?, requires_number=?, logo_url=?, active=?, is_free=? WHERE id=?`,
      [b.name, b.name_en || null, b.description || null, b.description_en || null, b.category || "general", b.subcategory || null,
       price, parseInt(b.stock || "0", 10), parseInt(b.max_per_user || "0", 10),
       b.requires_link ? 1 : 0, b.requires_number ? 1 : 0, b.logo_url || null, b.active === false ? 0 : 1, b.is_free ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.delete("/api/admin/products/:id", auth, admin, async (req, res) => {
  try { await q("UPDATE products SET active=0 WHERE id=?", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// Orders management
app.get("/api/admin/orders", auth, admin, async (req, res) => {
  try {
    const rows = await q(`SELECT o.*, p.name AS product_name, u.email, u.username, u.customer_id, u.whatsapp
      FROM orders o JOIN products p ON p.id=o.product_id JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 500`);
    res.json({ ok: true, orders: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/orders/:id/deliver", auth, admin, async (req, res) => {
  try {
    const { deliveryNote } = req.body || {};
    await q("UPDATE orders SET status='completed' WHERE id=?", [req.params.id]);
    // notify customer by email
    const [o] = await q("SELECT o.*, u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?", [req.params.id]);
    if (o.length && o[0].email) {
      const html = emailTemplate({ title: "تم تسليم طلبك", lang: "ar",
        bodyHtml: `<p>تم تسليم طلبك <b dir="ltr">${o[0].order_number}</b> بنجاح.</p>${deliveryNote ? `<p>ملاحظة التسليم: ${String(deliveryNote).slice(0, 1000)}</p>` : ""}` });
      sendEmail(o[0].email, "تم تسليم طلبك من NumberPlus", html).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/orders/:id/cancel", auth, admin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute("SELECT * FROM orders WHERE id=? FOR UPDATE", [req.params.id]);
    if (!rows.length) { await conn.rollback(); return res.status(404).json({ error: "not_found" }); }
    const o = rows[0];
    if (o.status === "cancelled") { await conn.rollback(); return res.json({ ok: true }); }
    await conn.execute("UPDATE orders SET status='cancelled' WHERE id=?", [o.id]);
    await conn.execute("UPDATE users SET balance = balance + ? WHERE id=?", [o.total_price, o.user_id]);
    await conn.execute("UPDATE products SET stock = stock + ? WHERE id=?", [o.quantity, o.product_id]);
    await conn.execute("INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?, 'refund', ?, 'balance', 'completed')", [o.user_id, o.total_price]);
    await conn.commit();
    res.json({ ok: true, refunded: o.total_price });
  } catch (e) { try { await conn.rollback(); } catch (_) {} console.error(e); res.status(500).json({ error: "server_error" }); }
  finally { conn.release(); }
});

// Users management
app.get("/api/admin/users", auth, admin, async (req, res) => {
  try {
    const s = String(req.query.search || "").trim();
    let rows;
    if (s) rows = await q("SELECT id, username, email, full_name, customer_id, balance, role, banned, created_at FROM users WHERE email LIKE ? OR username LIKE ? OR customer_id LIKE ? ORDER BY id DESC LIMIT 200",
      [`%${s}%`, `%${s}%`, `%${s}%`]);
    else rows = await q("SELECT id, username, email, full_name, customer_id, balance, role, banned, created_at FROM users ORDER BY id DESC LIMIT 200");
    res.json({ ok: true, users: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/users/:id/ban", auth, admin, async (req, res) => {
  try { await q("UPDATE users SET banned=1 WHERE id=?", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/users/:id/unban", auth, admin, async (req, res) => {
  try { await q("UPDATE users SET banned=0 WHERE id=?", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/users/:id/balance", auth, admin, async (req, res) => {
  try {
    const amt = Number(req.body.amount);
    if (!amt) return res.status(400).json({ error: "bad_amount" });
    await q("UPDATE users SET balance = balance + ? WHERE id=?", [amt, req.params.id]);
    await q("INSERT INTO transactions (user_id, type, amount, method, status) VALUES (?, 'charge', ?, 'admin', 'completed')", [req.params.id, amt]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/users/:id/reset-balance", auth, admin, async (req, res) => {
  try { await q("UPDATE users SET balance=0 WHERE id=?", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// Balance codes
app.post("/api/admin/balance-codes", auth, admin, async (req, res) => {
  try {
    const amount = Number(req.body.amount), count = Math.min(100, Math.max(1, parseInt(req.body.count || "1", 10)));
    if (!amount || amount <= 0) return res.status(400).json({ error: "bad_amount" });
    const codes = [];
    for (let i = 0; i < count; i++) {
      const c = "NP-" + genCode(10);
      await q("INSERT INTO balance_codes (code, amount) VALUES (?,?)", [c, amount]);
      codes.push(c);
    }
    res.json({ ok: true, codes });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.get("/api/admin/balance-codes", auth, admin, async (req, res) => {
  try {
    const rows = await q("SELECT bc.*, u.username AS used_by_name FROM balance_codes bc LEFT JOIN users u ON u.id=bc.used_by ORDER BY bc.id DESC LIMIT 200");
    res.json({ ok: true, codes: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// Tickets (admin)
app.get("/api/admin/tickets", auth, admin, async (req, res) => {
  try {
    const rows = await q("SELECT t.*, u.username, u.email FROM tickets t JOIN users u ON u.id=t.user_id ORDER BY t.id DESC LIMIT 200");
    res.json({ ok: true, tickets: rows });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/tickets/:id/reply", auth, admin, async (req, res) => {
  try {
    const { reply, close } = req.body || {};
    await q("UPDATE tickets SET admin_reply=?, status=? WHERE id=?", [String(reply || "").slice(0, 5000), close ? "closed" : "answered", req.params.id]);
    const [t] = await q("SELECT t.*, u.email FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.id=?", [req.params.id]);
    if (t.length && t[0].email) {
      const html = emailTemplate({ title: "رد جديد على تذكرتك", lang: "ar",
        bodyHtml: `<p>رد فريق الدعم على تذكرتك "<b>${t[0].subject}</b>":</p><div style="background:#f4f7ff;border-radius:10px;padding:14px">${String(reply || "").slice(0, 5000)}</div>` });
      sendEmail(t[0].email, "رد جديد على تذكرتك — NumberPlus", html).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// Notifications + email broadcast
app.post("/api/admin/notifications", auth, admin, async (req, res) => {
  try {
    const { title, message } = req.body || {};
    if (!title || !message) return res.status(400).json({ error: "missing_fields" });
    await q("INSERT INTO notifications (title, message) VALUES (?,?)", [String(title).slice(0, 200), String(message).slice(0, 5000)]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/email-broadcast", auth, admin, async (req, res) => {
  try {
    const { subject, message } = req.body || {};
    if (!subject || !message) return res.status(400).json({ error: "missing_fields" });
    const users = await q("SELECT email FROM users WHERE banned=0");
    const html = emailTemplate({ title: subject, lang: "ar", bodyHtml: `<div>${String(message).slice(0, 10000)}</div>` });
    let sent = 0;
    for (const u of users) {
      const r = await sendEmail(u.email, subject, html);
      if (r.ok) sent++;
    }
    res.json({ ok: true, sent, total: users.length });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// Settings + payment methods
app.get("/api/admin/settings", auth, admin, async (req, res) => {
  try {
    const rows = await q("SELECT `key`, `value` FROM settings");
    const obj = {}; for (const r of rows) obj[r.key] = r.value;
    const pms = await q("SELECT * FROM payment_methods ORDER BY id");
    res.json({ ok: true, settings: obj, paymentMethods: pms });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.put("/api/admin/settings", auth, admin, async (req, res) => {
  try {
    const b = req.body || {};
    for (const k of ["support_email", "support_whatsapp", "support_telegram", "social_links"]) {
      if (b[k] !== undefined) await q("INSERT INTO settings (`key`,`value`) VALUES (?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)", [k, typeof b[k] === "string" ? b[k] : JSON.stringify(b[k])]);
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.post("/api/admin/payment-methods", auth, admin, async (req, res) => {
  try {
    const { name, type, config, active } = req.body || {};
    if (!name) return res.status(400).json({ error: "missing_fields" });
    await q("INSERT INTO payment_methods (name, type, config, active) VALUES (?,?,?,?)",
      [name, type === "cryptomus" ? "cryptomus" : "manual", JSON.stringify(config || {}), active === false ? 0 : 1]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});
app.delete("/api/admin/payment-methods/:id", auth, admin, async (req, res) => {
  try { await q("UPDATE payment_methods SET active=0 WHERE id=?", [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error(e); res.status(500).json({ error: "server_error" }); }
});

// ---------- Static + SPA fallback ----------
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "not_found" });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---------- Boot ----------
(async () => {
  try {
    await initDb();
    console.log("[db] schema ready");
  } catch (e) {
    console.error("[db] init failed:", e.message);
    process.exit(1);
  }
  app.listen(cfg.port, "0.0.0.0", () => {
    console.log(`[numberplus-v3] listening on :${cfg.port}`);
  });
})();

process.on("unhandledRejection", (e) => console.error("[unhandled]", e && e.message));
