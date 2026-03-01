require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-env";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "nexyra.db");
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
const REQUIRE_EMAIL_VERIFIED = String(process.env.REQUIRE_EMAIL_VERIFIED || "false") === "true";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const billingPlans = [
  { id: "starter", label: "Starter Coaching", priceId: process.env.STRIPE_PRICE_ID_STARTER || "" },
  { id: "growth", label: "Growth Accelerator", priceId: process.env.STRIPE_PRICE_ID_GROWTH || "" },
  { id: "scale", label: "Scale Partner", priceId: process.env.STRIPE_PRICE_ID_SCALE || "" },
];

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const safeExec = (sql) => {
  try {
    db.exec(sql);
  } catch {
    // Ignore migration statements that already exist.
  }
};

safeExec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  owner_type TEXT NOT NULL,
  business_name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  struggles TEXT NOT NULL,
  support_needed TEXT NOT NULL,
  focus_title TEXT NOT NULL,
  service_matches TEXT NOT NULL,
  action_plan TEXT NOT NULL,
  ai_coaching TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS service_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  service_type TEXT NOT NULL,
  audience_type TEXT NOT NULL,
  industries TEXT NOT NULL,
  description TEXT NOT NULL,
  price_start INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  submission_id INTEGER,
  note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (provider_id) REFERENCES service_providers(id),
  FOREIGN KEY (submission_id) REFERENCES submissions(id)
);
`);

safeExec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;");

if (ADMIN_EMAIL) {
  db.prepare("UPDATE users SET is_admin = 1 WHERE email = ?").run(ADMIN_EMAIL);
}

const providerCount = db.prepare("SELECT COUNT(*) AS count FROM service_providers").get().count;
if (!providerCount) {
  const seed = db.prepare(
    "INSERT INTO service_providers (name, service_type, audience_type, industries, description, price_start) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const seedData = [
    ["AudienceLift Studio", "Marketing Positioning", "SMB founders", "Coaching, Services", "Messaging and audience growth campaigns.", 750],
    ["CloseLoop Advisors", "Sales Conversion", "B2B founders", "SaaS, Agencies", "Pipeline setup, scripts, and conversion systems.", 1200],
    ["BrandCraft Collective", "Brand Clarity", "Early-stage founders", "Retail, Creator", "Brand identity and launch content systems.", 900],
    ["OpsMomentum", "Operations & Systems", "Scaling teams", "E-commerce, Services", "SOPs, automation, and team workflow design.", 1500],
  ];
  for (const row of seedData) seed.run(...row);
}

app.use(express.json());
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? "*" : CORS_ORIGIN.split(",").map((item) => item.trim()),
  })
);
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nexyra-api" });
});

const recommendationMap = [
  {
    key: "marketing",
    title: "Marketing Positioning",
    keywords: ["market", "marketing", "visibility", "awareness", "promotion", "reach"],
    service: "Audience-first messaging and offer positioning sprint",
    action: "Define one core offer and one promise your audience can understand in under 10 seconds.",
  },
  {
    key: "sales",
    title: "Sales Conversion",
    keywords: ["sales", "close", "closing", "conversion", "leads", "pipeline"],
    service: "Sales funnel and follow-up script setup",
    action: "Set a weekly lead target and run a repeatable follow-up flow with clear call-to-action steps.",
  },
  {
    key: "branding",
    title: "Brand Clarity",
    keywords: ["brand", "branding", "identity", "message", "content"],
    service: "Brand identity and message clarity package",
    action: "Align your brand story, tagline, and top 3 proof points across website and social channels.",
  },
  {
    key: "pricing",
    title: "Pricing Strategy",
    keywords: ["price", "pricing", "profit", "margin", "cost"],
    service: "Offer design and pricing model review",
    action: "Create 3 pricing tiers with clear value differences and minimum margin targets.",
  },
  {
    key: "operations",
    title: "Operations & Systems",
    keywords: ["system", "operations", "time", "process", "workflow", "team"],
    service: "Operational workflow and automation mapping",
    action: "Document your delivery workflow end-to-end and automate one repetitive task this month.",
  },
  {
    key: "confidence",
    title: "Founder Confidence",
    keywords: ["confidence", "mindset", "fear", "overwhelm", "stuck", "clarity"],
    service: "Weekly accountability coaching sessions",
    action: "Choose one measurable weekly goal and review wins/lessons every Friday.",
  },
];

const defaultTrack = {
  key: "growth",
  title: "Growth Foundation",
  service: "General growth coaching and customer acquisition planning",
  action: "Define one target audience segment and one repeatable customer acquisition channel.",
};

const getTracks = (payload) => {
  const sourceText = `${payload.struggles} ${payload.supportNeeded}`.toLowerCase();
  const matched = recommendationMap.filter((track) =>
    track.keywords.some((word) => sourceText.includes(word))
  );

  if (!matched.length) return [defaultTrack];
  return matched.slice(0, 3);
};

const buildActionPlan = (payload, tracks) => {
  return [
    `Weeks 1-2: Clarify your niche and message for ${payload.targetAudience}.`,
    `Weeks 3-6: Execute ${tracks[0].title.toLowerCase()} actions and track 2 performance metrics weekly.`,
    "Weeks 7-10: Launch one offer campaign to validate demand and collect client feedback.",
    "Weeks 11-13: Optimize what worked, remove low-performing tasks, and set your next 90-day growth goal.",
  ];
};

const sanitizeSubmission = (body) => {
  const required = [
    "ownerType",
    "businessName",
    "businessType",
    "targetAudience",
    "struggles",
    "supportNeeded",
  ];

  for (const key of required) {
    if (!body[key] || typeof body[key] !== "string" || !body[key].trim()) {
      return { error: `Invalid ${key}` };
    }
  }

  return {
    ownerType: body.ownerType.trim(),
    businessName: body.businessName.trim(),
    businessType: body.businessType.trim(),
    targetAudience: body.targetAudience.trim(),
    struggles: body.struggles.trim(),
    supportNeeded: body.supportNeeded.trim(),
  };
};

const signToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: !!user.is_admin, emailVerified: !!user.email_verified },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
};

const serializeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  isAdmin: !!user.is_admin,
  emailVerified: !!user.email_verified,
});

const serializeSubmission = (submission) => ({
  id: submission.id,
  ownerType: submission.owner_type,
  businessName: submission.business_name,
  businessType: submission.business_type,
  targetAudience: submission.target_audience,
  struggles: submission.struggles,
  supportNeeded: submission.support_needed,
  focusTitle: submission.focus_title,
  serviceMatches: JSON.parse(submission.service_matches),
  actionPlan: JSON.parse(submission.action_plan),
  aiCoaching: submission.ai_coaching,
  createdAt: submission.created_at,
});

const createToken = () => crypto.randomBytes(24).toString("hex");
const tokenExpirySql = (hours) => `datetime('now', '+${hours} hours')`;

const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
};

const requireAdmin = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
};

const generateFallbackCoaching = (payload, tracks, actionPlan) => {
  return [
    `Primary coaching focus: ${tracks[0].title}.`,
    `Your next best move is to simplify your message for ${payload.targetAudience} and run one consistent weekly growth routine.`,
    `Start with this immediate action: ${tracks[0].action}`,
    `90-day anchor: ${actionPlan[0]}`,
  ].join(" ");
};

const generateAICoaching = async (payload, tracks, actionPlan) => {
  if (!process.env.OPENAI_API_KEY) {
    return generateFallbackCoaching(payload, tracks, actionPlan);
  }

  const prompt = `You are a business growth coach. Produce concise and practical coaching advice for this founder.
Business name: ${payload.businessName}
Business stage: ${payload.ownerType}
Business type: ${payload.businessType}
Target audience: ${payload.targetAudience}
Struggles: ${payload.struggles}
Support needed: ${payload.supportNeeded}
Top focus track: ${tracks.map((t) => t.title).join(", ")}
Action plan: ${actionPlan.join(" | ")}
Return 1 short paragraph (80-140 words), plain text.`;

  try {
    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: prompt,
      }),
    });

    if (!resp.ok) throw new Error("OpenAI request failed");
    const data = await resp.json();
    const text = data.output_text?.trim();
    if (!text) throw new Error("No output text");

    return text;
  } catch {
    return generateFallbackCoaching(payload, tracks, actionPlan);
  }
};

const createVerificationToken = (userId) => {
  const token = createToken();
  db.prepare("UPDATE email_verification_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(userId);
  db.prepare(
    `INSERT INTO email_verification_tokens (user_id, token, expires_at)
     VALUES (?, ?, ${tokenExpirySql(24)})`
  ).run(userId, token);
  return token;
};

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const passwordHash = bcrypt.hashSync(String(password), 10);
    const isAdmin = normalizedEmail && ADMIN_EMAIL && normalizedEmail === ADMIN_EMAIL ? 1 : 0;
    const result = db
      .prepare("INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, ?)")
      .run(String(name).trim(), normalizedEmail, passwordHash, isAdmin);

    const user = db
      .prepare("SELECT id, name, email, is_admin, email_verified FROM users WHERE id = ?")
      .get(result.lastInsertRowid);

    const verificationToken = createVerificationToken(user.id);
    console.log(`[email verification token] ${normalizedEmail}: ${verificationToken}`);

    const token = signToken(user);

    return res.json({
      token,
      user: serializeUser(user),
      verification: {
        sent: true,
        tokenPreview: process.env.NODE_ENV === "production" ? undefined : verificationToken,
      },
    });
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Email already registered" });
    }

    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const validPassword = bcrypt.compareSync(String(password), user.password_hash);
  if (!validPassword) return res.status(401).json({ error: "Invalid credentials" });

  if (REQUIRE_EMAIL_VERIFIED && !user.email_verified) {
    return res.status(403).json({ error: "Please verify your email before logging in" });
  }

  const token = signToken(user);
  return res.json({ token, user: serializeUser(user) });
});

app.post("/api/auth/request-verification", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  const user = db.prepare("SELECT id, email_verified FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (!user) return res.json({ ok: true });
  if (user.email_verified) return res.json({ ok: true, alreadyVerified: true });

  const verificationToken = createVerificationToken(user.id);
  console.log(`[email verification token] ${String(email).toLowerCase().trim()}: ${verificationToken}`);

  return res.json({
    ok: true,
    tokenPreview: process.env.NODE_ENV === "production" ? undefined : verificationToken,
  });
});

app.post("/api/auth/verify-email", (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: "Token is required" });

  const row = db
    .prepare(
      `SELECT * FROM email_verification_tokens
       WHERE token = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`
    )
    .get(String(token).trim());

  if (!row) return res.status(400).json({ error: "Invalid or expired token" });

  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(row.user_id);
  db.prepare("UPDATE email_verification_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);

  const user = db.prepare("SELECT id, name, email, is_admin, email_verified FROM users WHERE id = ?").get(row.user_id);
  const jwtToken = signToken(user);
  return res.json({ ok: true, token: jwtToken, user: serializeUser(user) });
});

app.post("/api/auth/request-password-reset", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email is required" });

  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (!user) return res.json({ ok: true });

  const token = createToken();
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(user.id);
  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES (?, ?, ${tokenExpirySql(2)})`
  ).run(user.id, token);

  console.log(`[password reset token] ${String(email).toLowerCase().trim()}: ${token}`);
  return res.json({ ok: true, tokenPreview: process.env.NODE_ENV === "production" ? undefined : token });
});

app.post("/api/auth/reset-password", (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }

  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  const row = db
    .prepare(
      `SELECT * FROM password_reset_tokens
       WHERE token = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')`
    )
    .get(String(token).trim());

  if (!row) return res.status(400).json({ error: "Invalid or expired token" });

  const passwordHash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, row.user_id);
  db.prepare("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);

  return res.json({ ok: true });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, name, email, is_admin, email_verified FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json(serializeUser(user));
});

app.post("/api/intake", requireAuth, async (req, res) => {
  const payload = sanitizeSubmission(req.body || {});
  if (payload.error) return res.status(400).json({ error: payload.error });

  const tracks = getTracks(payload);
  const actionPlan = buildActionPlan(payload, tracks);
  const aiCoaching = await generateAICoaching(payload, tracks, actionPlan);

  const result = db
    .prepare(
      `INSERT INTO submissions (
        user_id, owner_type, business_name, business_type, target_audience,
        struggles, support_needed, focus_title, service_matches, action_plan, ai_coaching
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      payload.ownerType,
      payload.businessName,
      payload.businessType,
      payload.targetAudience,
      payload.struggles,
      payload.supportNeeded,
      tracks[0].title,
      JSON.stringify(tracks.map((t) => t.service)),
      JSON.stringify(actionPlan),
      aiCoaching
    );

  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(result.lastInsertRowid);
  return res.json({ submission: serializeSubmission(submission), tracks });
});

app.get("/api/intake/latest", requireAuth, (req, res) => {
  const submission = db
    .prepare("SELECT * FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(req.user.id);

  if (!submission) return res.status(404).json({ error: "No submissions found" });
  return res.json(serializeSubmission(submission));
});

app.get("/api/providers/matches", requireAuth, (req, res) => {
  const latest = db
    .prepare("SELECT * FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(req.user.id);

  if (!latest) return res.status(404).json({ error: "Submit intake first to get provider matches" });

  const providers = db.prepare("SELECT * FROM service_providers WHERE active = 1 ORDER BY id DESC").all();
  const focus = latest.focus_title.toLowerCase();
  const audience = latest.target_audience.toLowerCase();

  const scored = providers.map((provider) => {
    let score = 0;
    if (provider.service_type.toLowerCase().includes(focus) || focus.includes(provider.service_type.toLowerCase())) score += 3;
    if (audience.includes(provider.audience_type.toLowerCase())) score += 2;
    if (provider.industries.toLowerCase().includes("services") && latest.business_type.toLowerCase().includes("service")) score += 1;
    return { ...provider, score };
  });

  scored.sort((a, b) => b.score - a.score || a.price_start - b.price_start);
  return res.json(scored.slice(0, 6));
});

app.post("/api/providers/:providerId/request", requireAuth, (req, res) => {
  const providerId = Number(req.params.providerId);
  const note = String(req.body?.note || "Interested in discussing support options.").trim();
  if (!providerId) return res.status(400).json({ error: "Invalid provider id" });

  const provider = db.prepare("SELECT id FROM service_providers WHERE id = ? AND active = 1").get(providerId);
  if (!provider) return res.status(404).json({ error: "Provider not found" });

  const latestSubmission = db
    .prepare("SELECT id FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(req.user.id);

  const result = db
    .prepare(
      "INSERT INTO service_requests (user_id, provider_id, submission_id, note) VALUES (?, ?, ?, ?)"
    )
    .run(req.user.id, providerId, latestSubmission?.id || null, note);

  return res.json({ ok: true, requestId: result.lastInsertRowid });
});

app.get("/api/billing/plans", requireAuth, (req, res) => {
  return res.json(
    billingPlans.map((plan) => ({
      id: plan.id,
      label: plan.label,
      available: !!(stripe && plan.priceId),
    }))
  );
});

app.post("/api/billing/create-checkout-session", requireAuth, async (req, res) => {
  const { planId } = req.body || {};
  const plan = billingPlans.find((item) => item.id === planId);
  if (!plan) return res.status(400).json({ error: "Invalid plan" });

  if (!stripe || !plan.priceId) {
    return res.status(400).json({ error: "Stripe is not configured for this plan yet" });
  }

  const origin = process.env.APP_ORIGIN || req.headers.origin || `http://localhost:${PORT}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${origin}/?checkout=success&plan=${plan.id}`,
      cancel_url: `${origin}/?checkout=cancelled`,
      client_reference_id: String(req.user.id),
      customer_email: req.user.email,
      metadata: { planId: plan.id },
    });

    return res.json({ url: session.url });
  } catch {
    return res.status(500).json({ error: "Unable to create checkout session" });
  }
});

app.get("/api/admin/submissions", requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.id, s.business_name, s.focus_title, s.created_at, u.email, u.name
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC
       LIMIT 100`
    )
    .all();

  return res.json(rows);
});

app.get("/api/admin/requests", requireAuth, requireAdmin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT r.id, r.status, r.note, r.created_at, u.email, u.name, p.name AS provider_name
       FROM service_requests r
       JOIN users u ON u.id = r.user_id
       JOIN service_providers p ON p.id = r.provider_id
       ORDER BY r.id DESC
       LIMIT 100`
    )
    .all();

  return res.json(rows);
});

app.post("/api/admin/providers", requireAuth, requireAdmin, (req, res) => {
  const { name, serviceType, audienceType, industries, description, priceStart } = req.body || {};
  if (!name || !serviceType || !audienceType || !industries || !description || !priceStart) {
    return res.status(400).json({ error: "Missing provider fields" });
  }

  const result = db
    .prepare(
      `INSERT INTO service_providers
      (name, service_type, audience_type, industries, description, price_start)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(name).trim(),
      String(serviceType).trim(),
      String(audienceType).trim(),
      String(industries).trim(),
      String(description).trim(),
      Number(priceStart)
    );

  return res.json({ ok: true, id: result.lastInsertRowid });
});

app.listen(PORT, () => {
  console.log(`Nexyra app running on http://localhost:${PORT}`);
});
