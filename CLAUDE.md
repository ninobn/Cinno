Update the CLAUDE.md file in the project root with the following roadmap and project context. Replace any outdated roadmap/phase information but keep existing technical rules (Windows environment, no bash, etc.) intact.



Add or update these sections:



=== PROJECT VISION ===

Cinno is a personal movie companion web app evolving into a modern, social editorial hub — think Letterboxd meets Apple TV+ meets a personal film magazine. The design language is shifting from a utility app to a premium editorial experience with large typography, curated sections, AI-powered insights, and social features.



=== CURRENT STATE (as of May 2026) ===

\- Phase 1 (Auth): Complete — Google OAuth + guest mode via Supabase

\- Phase 2 (Database migration): Complete — all 5 data layers migrated to Supabase (chat, preferences, watchlist/collections, journal/rankings, swipe data) with localStorage fallback

\- Phase 3 (Deployment): Complete — Frontend on Vercel (cinno-five.vercel.app), proxy server on Railway (cinno-production.up.railway.app), auto-deploys on git push

\- Security hardening: Complete — JWT auth on proxy, per-user rate limits, TMDB proxied server-side, persistent budget counters, sync-failure toasts

\- Visual polish: Complete — tab transitions, hover states, skeleton loaders, modal preloading, scroll snap, button feedback

\- Home tab redesign: Complete — horizontal top nav, hero banner with FEATURED badge + 3 action buttons, Your Reel stats card, Cinno companion chat widget, Your Taste AI editorial summary, personalized movie sections (Because You Watched, Popular You Haven't Seen), From Your Journal section



=== NAVIGATION ===

Horizontal top bar (fixed): Cinno logo, Home, Discover, Journal, Watchlist, Cinno (AI chat, formerly "Companion"), Friends (SOON badge, non-functional), search bar, settings gear, user avatar.



=== ROADMAP ===



Phase 5A — Dashboard Cards Polish (NEXT)

Priority: Quick win. Redesign the Your Reel + Cinno chat card row on the Home tab. Add more contrast, visual interest, or a third card to make the section feel functional rather than filler. Explore options before committing to a design.



Phase 5B — Tab Redesign Overhaul

Redesign Watchlist, Journal, Discover, and Cinno (chat) tabs to match the Home tab's modern editorial style. Each tab to be explored and designed individually — don't apply a blanket style. Key principles: large editorial typography, curated feel, breathing room, dark theme with cream accents, premium not utilitarian.



Phase 5C — Journal Enhancement

After the redesign overhaul, improve quality of life features within Journal: better Stats visualizations, Rankings improvements, richer entry editing, and any UX friction discovered during the redesign.



Phase 5D — Friends \& Social Tab

Build out the Friends tab. Scope TBD — will be explored before committing to a feature set. Possible directions: follow users, activity feeds, shared watchlists, reviews, likes, comments. Requires new Supabase tables and potentially new auth flows.



=== TAB NAMING ===

\- Home (was Search) — personalized editorial landing page

\- Discover — Tinder-style swipe recommendation engine

\- Journal — watch tracking, ratings, Rankings podium, Stats bento grid

\- Watchlist — collections, Up Next banner

\- Cinno — AI chat assistant with Smart Mode (was "Chat", then "Companion")

\- Friends — social features (SOON, not yet built)



=== DESIGN DIRECTION ===

Moving toward: modern social editorial hub. Magazine-style layouts, large serif-weight headings, editorial eyebrow labels (e.g., "— CURATED · MAY 2026 —"), AI-generated taste summaries, personalized dynamic sections. Away from: utility app with basic grids and lists.



Color palette: dark #1A0A14, cream #F5F0EB, burgundy #8B2040, gold #D4B05C. Plus Jakarta Sans. TMDB backdrops with dark gradient overlays.



=== KEY TECHNICAL PATTERNS ===

\- Supabase primary → localStorage fallback on failure → localStorage-only for guests

\- Fire-and-forget Supabase writes with debounced sync-failure toasts

\- TMDB calls proxied through server.js (/api/tmdb authenticated, /api/tmdb-public for guests)

\- JWT verification via supabase.auth.getUser(token) on all proxy endpoints

\- Per-user rate limiting and persistent daily budget counters (Supabase api\_budget\_counter table)

\- Auto-deploy: git push to master → Vercel (frontend) + Railway (server) auto-redeploy

