# CineCompanion 🎬

A sleek, dark-themed movie companion web app with real-time TMDB search, trending movies, and an AI-powered movie chatbot.

## Features

- **Search** — Search any movie in the world via TMDB API. Trending movies shown on homepage.
- **Save** — Bookmark movies to your watchlist with hover-to-save.
- **Chat** — AI chatbot (Claude) for movie recommendations, plot analysis, and post-watch debriefing. Multiple conversation threads with auto-generated titles.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure API keys** — Edit `.env` in the project root:
   ```
   VITE_TMDB_API_KEY=your_tmdb_key_here
   VITE_API_URL=http://localhost:3001
   ANTHROPIC_API_KEY=your_anthropic_key_here
   TAVILY_API_KEY=your_tavily_key_here
   ```
   - TMDB key: Get one free at https://www.themoviedb.org/settings/api
   - Anthropic key: Get one at https://console.anthropic.com
   - Tavily key: Get one at https://tavily.com

3. **Run:**
   ```bash
   npm run dev
   ```
   Open http://localhost:5173

## Tech Stack

- React 18 + Vite
- TMDB API (movie data & posters)
- Anthropic Claude API (chat)
- Custom CSS (dark theme, responsive)

## Build for Production

```bash
npm run build
```

Output goes to `dist/` — deploy anywhere (Vercel, Netlify, etc).
