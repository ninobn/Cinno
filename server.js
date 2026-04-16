import "dotenv/config";
import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Supabase server client (for JWT verification + budget persistence) ────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  process.env.PRODUCTION_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
}));

// ─── Request Size Limits ────────────────────────────────────────────────────────
const chatBodyLimit = express.json({ limit: "10kb" });
const searchBodyLimit = express.json({ limit: "1kb" });
const tmdbBodyLimit = express.json({ limit: "2kb" });
app.use(express.json({ limit: "10kb" }));

// ─── Auth Middleware ────────────────────────────────────────────────────────────
async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: { message: "Missing authorization token" } });
  }
  const token = authHeader.split(" ")[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: { message: "Invalid or expired token" } });
  }
  req.user = user;
  next();
}

// ─── Rate Limiting (in-memory, per user) ────────────────────────────────────────
const rateLimits = new Map();

function rateLimit(endpoint, maxPerMinute) {
  return (req, res, next) => {
    const key = `${endpoint}:${req.user.id}`;
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

// ─── IP-based Rate Limiting (for public endpoints) ──────────────────────────────
const ipRateLimits = new Map();

function rateLimitByIP(endpoint, maxPerMinute) {
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "unknown";
    const key = `${endpoint}:${ip}`;
    const now = Date.now();
    let entry = ipRateLimits.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + 60000 };
      ipRateLimits.set(key, entry);
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
  for (const [key, entry] of ipRateLimits) {
    if (now > entry.resetAt) ipRateLimits.delete(key);
  }
}, 5 * 60 * 1000);

// ─── Daily API Budget (Supabase-backed with in-memory cache) ───────────────────
let budgetCache = { date: null, chat_count: 0, search_count: 0, fetchedAt: 0 };
const BUDGET_CACHE_TTL = 10000; // 10 seconds

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function getBudget() {
  const today = getTodayDate();
  const now = Date.now();

  if (budgetCache.date === today && (now - budgetCache.fetchedAt) < BUDGET_CACHE_TTL) {
    return { chat_count: budgetCache.chat_count, search_count: budgetCache.search_count };
  }

  try {
    const { data, error } = await supabase
      .from("api_budget_counter")
      .select("chat_count, search_count")
      .eq("date", today)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("Budget fetch error:", error.message);
      return { chat_count: budgetCache.chat_count, search_count: budgetCache.search_count };
    }

    const counts = data || { chat_count: 0, search_count: 0 };
    budgetCache = { date: today, chat_count: counts.chat_count, search_count: counts.search_count, fetchedAt: now };
    return counts;
  } catch (err) {
    console.error("Budget fetch exception:", err.message);
    return { chat_count: budgetCache.chat_count, search_count: budgetCache.search_count };
  }
}

async function incrementBudget(type) {
  const today = getTodayDate();
  const field = type === "chat" ? "chat_count" : "search_count";

  // Update in-memory cache immediately
  if (budgetCache.date === today) {
    budgetCache[field]++;
  }

  try {
    // Try to insert a new row for today
    const { error: insertError } = await supabase
      .from("api_budget_counter")
      .insert({ date: today, chat_count: type === "chat" ? 1 : 0, search_count: type === "search" ? 1 : 0 });

    if (insertError) {
      // Row already exists — update with increment
      if (insertError.code === "23505") {
        const { data: current } = await supabase
          .from("api_budget_counter")
          .select(field)
          .eq("date", today)
          .single();

        if (current) {
          await supabase
            .from("api_budget_counter")
            .update({ [field]: current[field] + 1, updated_at: new Date().toISOString() })
            .eq("date", today);
        }
      } else {
        console.error("Budget increment insert error:", insertError.message);
      }
    }
  } catch (err) {
    console.error("Budget increment exception:", err.message);
  }
}

async function checkBudget(type) {
  const budget = await getBudget();
  const count = type === "chat" ? budget.chat_count : budget.search_count;
  const max = type === "chat" ? 200 : 50;
  return count < max;
}

// ─── TMDB Proxy Helpers ─────────────────────────────────────────────────────────
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_KEY = process.env.TMDB_API_KEY;

const ALLOWED_TMDB_PREFIXES = ["/movie", "/tv", "/search", "/discover", "/trending", "/genre", "/configuration"];
const PUBLIC_TMDB_PREFIXES = ["/movie", "/trending", "/genre", "/configuration", "/search", "/discover"];

function isAllowedTmdbPath(path, prefixes) {
  if (typeof path !== "string") return false;
  return prefixes.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}

async function proxyTmdb(path, params = {}) {
  const url = new URL(`${TMDB_BASE}${path}`);
  url.searchParams.set("api_key", TMDB_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });

  const resp = await fetch(url.toString());
  const data = await resp.json();

  if (!resp.ok) {
    const err = new Error(data?.status_message || `TMDB error: ${resp.status}`);
    err.status = resp.status;
    err.body = data;
    throw err;
  }

  return data;
}

// ─── Routes ─────────────────────────────────────────────────────────────────────

const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
const MAX_TOKENS_CAP = 2000;
const MAX_MESSAGES = 50;

// TMDB proxy — authenticated users (120 req/min per user)
app.post("/api/tmdb", verifyAuth, tmdbBodyLimit, rateLimit("tmdb", 120), async (req, res) => {
  try {
    const { path, params } = req.body;

    if (!path || typeof path !== "string") {
      return res.status(400).json({ error: { message: "path is required" } });
    }

    if (!isAllowedTmdbPath(path, ALLOWED_TMDB_PREFIXES)) {
      return res.status(400).json({ error: { message: "TMDB path not allowed" } });
    }

    const data = await proxyTmdb(path, params || {});
    res.json(data);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    console.error("TMDB proxy error:", err.message);
    res.status(500).json({ error: { message: "TMDB proxy error" } });
  }
});

// TMDB proxy — public/guest (30 req/min per IP, restricted paths)
app.post("/api/tmdb-public", tmdbBodyLimit, rateLimitByIP("tmdb-public", 30), async (req, res) => {
  try {
    const { path, params } = req.body;

    if (!path || typeof path !== "string") {
      return res.status(400).json({ error: { message: "path is required" } });
    }

    if (!isAllowedTmdbPath(path, PUBLIC_TMDB_PREFIXES)) {
      return res.status(400).json({ error: { message: "TMDB path not allowed" } });
    }

    const data = await proxyTmdb(path, params || {});
    res.json(data);
  } catch (err) {
    if (err.status && err.body) {
      return res.status(err.status).json(err.body);
    }
    console.error("TMDB public proxy error:", err.message);
    res.status(500).json({ error: { message: "TMDB proxy error" } });
  }
});

app.post("/api/search", verifyAuth, searchBodyLimit, rateLimit("search", 10), async (req, res) => {
  try {
    const allowed = await checkBudget("search");
    if (!allowed) {
      return res.status(429).json({ error: { message: "Daily search limit reached. Try again tomorrow." } });
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

    // Fire-and-forget budget increment
    incrementBudget("search").catch(() => {});
  } catch (err) {
    console.error("Tavily proxy error:", err);
    res.status(500).json({ error: "Search proxy error" });
  }
});

app.post("/api/chat", verifyAuth, chatBodyLimit, rateLimit("chat", 20), async (req, res) => {
  try {
    const allowed = await checkBudget("chat");
    if (!allowed) {
      return res.status(429).json({ error: { message: "Daily chat limit reached. Try again tomorrow." } });
    }

    const { model, max_tokens, system, messages } = req.body;

    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ error: { message: `Model not allowed. Use: ${ALLOWED_MODELS.join(", ")}` } });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "messages array required" } });
    }

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

    // Fire-and-forget budget increment
    incrementBudget("chat").catch(() => {});
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
