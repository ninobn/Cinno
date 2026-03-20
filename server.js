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
    cb(new Error("Not allowed by CORS"));
  },
}));
app.use(express.json());

const ALLOWED_MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
const MAX_TOKENS_CAP = 2000;

app.post("/api/search", async (req, res) => {
  try {
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

app.post("/api/chat", async (req, res) => {
  try {
    const { model, max_tokens, system, messages } = req.body;

    if (!ALLOWED_MODELS.includes(model)) {
      return res.status(400).json({ error: { message: `Model not allowed. Use: ${ALLOWED_MODELS.join(", ")}` } });
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: "messages array required" } });
    }
    const cappedTokens = Math.min(Number(max_tokens) || 1000, MAX_TOKENS_CAP);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, max_tokens: cappedTokens, system, messages }),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: { message: "Proxy server error" } });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
