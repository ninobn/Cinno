import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  process.env.PRODUCTION_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Allow local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x) for mobile dev
    if (/^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
}));

// ─── Request Size Limits ────────────────────────────────────────────────────────
// Apply per-route body size limits via middleware (before routes)
const chatBodyLimit = express.json({ limit: "10kb" });
const searchBodyLimit = express.json({ limit: "1kb" });
// Fallback for any other routes
app.use(express.json({ limit: "10kb" }));

// ─── Rate Limiting (in-memory, per IP) ──────────────────────────────────────────
const rateLimits = new Map(); // key: "endpoint:ip" → { count, resetAt }

function rateLimit(endpoint, maxPerMinute) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const key = `${endpoint}:${ip}`;
    const now = Date.now();
    let entry = rateLimits.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60000 };
      rateLimits.set(key, entry);
    }

    entry.count++;
    if (entry.count > maxPerMinute) {
      return res.status(429).json({ error: { message: "Too many requests. Please wait a moment." } });
    }

    next();
  };
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Daily API Budget (in-memory, resets on server restart) ─────────────────────
const dailyBudget = {
  chat: { count: 0, max: 200, resetAt: getEndOfDay() },
  search: { count: 0, max: 50, resetAt: getEndOfDay() },
};

function getEndOfDay() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function checkBudget(type) {
  const budget = dailyBudget[type];
  const now = Date.now();
  if (now > budget.resetAt) {
    budget.count = 0;
    budget.resetAt = getEndOfDay();
  }
  budget.count++;
  return budget.count <= budget.max;
}

// ─── Routes ─────────────────────────────────────────────────────────────────────

const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
const MAX_TOKENS_CAP = 2000;
const MAX_MESSAGES = 50;

app.post("/api/search", searchBodyLimit, rateLimit("search", 10), async (req, res) => {
  try {
    if (!checkBudget("search")) {
      return res.status(503).json({ error: { message: "Daily search limit reached. Try again tomorrow." } });
    }

    const { query } = req.body;
    if (!query || typeof query !== "string") return res.status(400).json({ error: "query required" });

    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: query.slice(0, 500),
        max_results: 5,
        include_answer: true,
      }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Tavily proxy error:", err);
    res.status(500).json({ error: "Search proxy error" });
  }
});

app.post("/api/chat", chatBodyLimit, rateLimit("chat", 20), async (req, res) => {
  try {
    if (!checkBudget("chat")) {
      return res.status(503).json({ error: { message: "Daily chat limit reached. Try again tomorrow." } });
    }

    const { model, max_tokens, system, messages } = req.body;

    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ error: { message: `Model not allowed. Use: ${ALLOWED_MODELS.join(", ")}` } });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "messages array required" } });
    }

    // Truncate messages to last MAX_MESSAGES to prevent payload abuse
    const truncatedMessages = messages.slice(-MAX_MESSAGES);

    const cappedTokens = Math.min(Number(max_tokens) || 1000, MAX_TOKENS_CAP);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: cappedTokens, system, messages: truncatedMessages }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: { message: "Proxy server error" } });
  }
});

// Body size limit error handler
app.use((err, _req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: { message: "Request too large." } });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
