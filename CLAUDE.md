\## Cinno Project Rules



\### Environment

\- This is a Windows machine. NEVER use the Bash tool. NEVER try to run shell commands. Only edit files directly.

\- The user will test everything in the browser manually.



\### Project

\- App name is Cinno, a movie companion web app

\- Uses React + Vite, TMDB API, and Anthropic Claude API via a proxy server

\- All state is stored in localStorage



\### Code Style

\- Dark minimal UI, same style throughout

\- Use CSS media queries for responsive design

\- No external chart libraries, use SVG

\- No markdown, no bold, no emojis in AI chat responses



\## Current Roadmap (in order)



\### Phase 1: Smart Discover Engine

\- Build taste profile from journal data (genre scores, decade preferences, top 5 keyword analysis)

\- Fetch movies via TMDB /discover/movie with weighted parameters from taste profile

\- Exclude all movies already in watchlist or journal

\- Real-time swipe learning: right swipe boosts genres +5, left swipe penalizes +3

\- Every 5 swipes refetch with adjusted weights

\- Mix in 20% random movies from outside top genres

\- Store swipe weights in localStorage, merge with journal data at 70/30 ratio

\- Use TMDB /movie/{id}/keywords for top 5 rated movies to get taste keywords



\### Phase 2: UI Polish Pass

\- Consistent card backgrounds across all tabs (no gray gradients in light mode)

\- Consistent spacing using 8px grid system

\- Consistent border radius (16px cards, 12px posters)

\- Fix any misaligned buttons, overflowing text, or inconsistent padding

\- Ensure all hover states and tap feedback are present everywhere

\- Fix the broken rating badge on first Search movie

\- Do NOT add features, only polish existing UI



\### Phase 3: Movie Identity in Stats

\- Analyze journal genre distribution and average ratings per genre

\- Map to identity archetypes (The Thrill Seeker, The Deep Feeler, etc)

\- Display as prominent card at top of Stats view

\- Add 2-3 smaller trait tags below

\- Update whenever journal data changes

\- Store in localStorage

\- No API calls needed, all local logic



\### Phase 4: End Debrief → Auto Journal

\- Add "End Debrief" button in chat top bar for debrief chats only

\- Send conversation to AI proxy to extract rating, key thoughts, summary

\- Show editable journal entry modal with slider, text fields, date

\- User reviews and saves to journal in same format as manual entries

\- Toast confirmation on save



\### Phase 5: Dark Mode Fix

\- Test dark mode toggle thoroughly

\- Fix any colors, backgrounds, or borders that look wrong in dark mode

\- Ensure all cards, modals, and charts work in both themes



\### Phase 6: Deployment Prep

\- Setup for Vercel/Netlify frontend deployment

\- Setup for Railway/Render backend proxy

\- Environment variable configuration

\- PWA manifest and service worker

