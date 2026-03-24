\## Current Roadmap



\### STATUS: Pre-deployment polish + Supabase migration



\### Phase 1: Supabase Auth + Guest Mode (DO FIRST)

\- Set up Supabase project and configure in .env (VITE\_SUPABASE\_URL, VITE\_SUPABASE\_ANON\_KEY)

\- Install @supabase/supabase-js

\- Create auth context/provider wrapping the app

\- Three auth states: logged out (guest), logged in (Google), logged in (Apple)

\- Guest mode: user can browse Search tab fully (hero banner, sections, search, genre filter, movie modal viewing)

\- Guest restrictions: when guest tries to save to watchlist, add to journal, use chat, or use discover, show a clean modal: "Sign in to unlock this feature" with Google and Apple sign-in buttons and a "Continue browsing" dismiss button

\- Google OAuth login via Supabase Auth

\- Apple OAuth login via Supabase Auth

\- Auth UI: clean login screen with Cinno logo, "Welcome to Cinno" heading, Google and Apple sign-in buttons, and "Continue as guest" link below

\- Show user profile icon in header when logged in (replace settings icon or add next to it)

\- Logout option in settings



\### Phase 2: Supabase Database Migration

\- Create database tables:

&#x20; - watchlist (id, user\_id, tmdb\_id, movie\_data jsonb, created\_at)

&#x20; - journal (id, user\_id, tmdb\_id, movie\_data jsonb, rating, notes, watch\_date, created\_at)

&#x20; - collections (id, user\_id, name, created\_at)

&#x20; - collection\_movies (id, collection\_id, tmdb\_id, created\_at)

&#x20; - chat\_conversations (id, user\_id, title, messages jsonb, created\_at, updated\_at)

&#x20; - user\_preferences (id, user\_id, theme, discover\_weights jsonb, pinned\_movie\_id, showcase\_badges jsonb, smart\_mode boolean)

\- Replace ALL localStorage reads/writes with Supabase queries

\- On first login: check if localStorage has existing data, if yes show "Import your existing data?" prompt, migrate all localStorage data to Supabase under the user's account

\- After migration, clear localStorage movie data (keep theme preference locally for fast load)

\- Add loading states for all database operations

\- Handle offline gracefully — show cached data if network fails



\### Phase 3: Deploy

\- Build frontend for production: npm run build

\- Deploy frontend to Vercel

\- Deploy proxy server (server.js) to Railway or Render

\- Set environment variables on both platforms:

&#x20; - Vercel: VITE\_SUPABASE\_URL, VITE\_SUPABASE\_ANON\_KEY, VITE\_API\_URL (pointing to Railway/Render proxy URL), VITE\_TMDB\_API\_KEY

&#x20; - Railway/Render: ANTHROPIC\_API\_KEY, TAVILY\_API\_KEY, PRODUCTION\_URL (Vercel URL for CORS)

\- Update CORS in server.js to allow the production Vercel URL

\- Test full flow: guest browse → sign in → data sync → all features work

\- Add Vercel Analytics

\- PWA manifest + service worker for installability



\### Phase 4: Post-launch Polish

\- Monitor for bugs via Vercel Analytics

\- Dark mode thorough testing

\- Performance optimization

\- End Debrief → auto journal feature

\- Movie Identity refinement

\- Year-end Wrapped feature (build closer to December)

