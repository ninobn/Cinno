import React, { useState, useRef, useEffect, useMemo, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { getTrending, getPopular, getSimilar, searchMovies, discoverByGenres, discoverMovies, discoverMoviesRaw, getWatchProviders, getMovieDetails, getMovieById, getSmartContext, tmdbToMovie, IMG_BASE, GENRE_MAP } from "./tmdb.js";
import { useAuth } from "./AuthContext.jsx";
import { useFloating, offset, flip, shift, autoUpdate, FloatingPortal } from "@floating-ui/react";
import { DateTime } from "luxon";
import AOS from "aos";
import "aos/dist/aos.css";
import Swal from "sweetalert2";
import * as chatService from "./services/chatService.js";
import * as preferencesService from "./services/preferencesService.js";
import * as watchlistService from "./services/watchlistService.js";
import * as journalService from "./services/journalService.js";
import * as discoverService from "./services/discoverService.js";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ─── SweetAlert2 Toast mixin ───────────────────────────────────────────────────
const Toast = Swal.mixin({
  toast: true,
  position: "bottom-end",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
  customClass: { popup: "cinno-swal-popup" },
});

// ─── Debounced sync-failure toast (5s cooldown) ────────────────────────────────
let _lastSyncFailToast = 0;
function syncFailToast(e) {
  console.error("Failed to sync:", e);
  const now = Date.now();
  if (now - _lastSyncFailToast > 5000) {
    _lastSyncFailToast = now;
    Toast.fire({ icon: "warning", title: "Change may not be saved", text: "Sync failed — will retry on next reload." });
  }
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, textAlign: "center", color: "#F5F0EB", background: "#1A0A14", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: "#A89B9E", marginBottom: 16, maxWidth: 360 }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ padding: "10px 24px", background: "#C9A84C", color: "#1A0A14", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function showToast(msg, onUndo) {
  if (onUndo) {
    Swal.fire({
      toast: true,
      position: "bottom-end",
      icon: "success",
      title: msg,
      showConfirmButton: true,
      confirmButtonText: "Undo",
      timer: 5000,
      timerProgressBar: true,
      customClass: { popup: "cinno-swal-popup", confirmButton: "cinno-swal-undo-btn" },
    }).then((result) => {
      if (result.isConfirmed) onUndo();
    });
  } else {
    Toast.fire({ icon: "success", title: msg });
  }
}

const GENRE_COLORS = {
  Action: "#C4856A", Adventure: "#8BA88C", Animation: "#7AADA0", Comedy: "#C4B07A",
  Crime: "#A87070", Documentary: "#7A96AD", Drama: "#8B7EA8", Family: "#AD8EB8",
  Fantasy: "#9A86B8", History: "#A09880", Horror: "#8B2635", Music: "#7AADB8",
  Mystery: "#8A7A70", Romance: "#B8707E", "Sci-Fi": "#6AA0A0", Thriller: "#7A6A90",
  War: "#7A8A6B", Western: "#AD8A5E", Film: "#7A7878",
};

// ─── Luxon date formatting helpers ──────────────────────────────────────────────

function formatWatchDate(dateStr) {
  if (!dateStr) return null;
  const dt = DateTime.fromISO(dateStr);
  if (!dt.isValid) return null;
  const now = DateTime.now();
  const diffDays = Math.floor(now.diff(dt, "days").days);
  if (diffDays < 1 && dt.hasSame(now, "day")) return "today";
  if (diffDays < 7) return dt.toRelative();
  if (dt.year === now.year) return dt.toFormat("MMM d");
  return dt.toFormat("MMM d, yyyy");
}

function formatChatTimestamp(ts) {
  if (!ts) return null;
  const dt = typeof ts === "number" ? DateTime.fromMillis(ts) : DateTime.fromISO(ts);
  if (!dt.isValid) return null;
  const now = DateTime.now();
  const diffMins = now.diff(dt, "minutes").minutes;
  if (diffMins < 60) return dt.toRelative();
  if (dt.hasSame(now, "day")) return dt.toFormat("h:mm a");
  if (dt.hasSame(now.minus({ days: 1 }), "day")) return `Yesterday, ${dt.toFormat("h:mm a")}`;
  if (dt.year === now.year) return dt.toFormat("MMM d");
  return dt.toFormat("MMM d, yyyy");
}

function formatAddedDate(dateStr) {
  if (!dateStr) return null;
  const dt = typeof dateStr === "number" ? DateTime.fromMillis(dateStr) : DateTime.fromISO(dateStr);
  if (!dt.isValid) return null;
  const now = DateTime.now();
  const diffDays = Math.floor(now.diff(dt, "days").days);
  if (diffDays < 1 && dt.hasSame(now, "day")) return "Added today";
  if (diffDays < 7) return `Added ${dt.toRelative()}`;
  if (dt.year === now.year) return `Added ${dt.toFormat("MMM d")}`;
  return `Added ${dt.toFormat("MMM d, yyyy")}`;
}

// Preloads the backdrop image before showing the modal so the top of the modal
// doesn't flash empty. Falls through after 500ms on slow connections.
function useMovieModal() {
  const [selectedMovie, _setSelectedMovie] = useState(null);
  const timerRef = useRef(null);
  const tokenRef = useRef(0);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const setSelectedMovie = useCallback((movie) => {
    clearTimeout(timerRef.current);
    const token = ++tokenRef.current;
    if (!movie || !movie.backdrop_path) {
      _setSelectedMovie(movie);
      return;
    }
    let opened = false;
    const open = () => {
      if (opened || tokenRef.current !== token) return;
      opened = true;
      _setSelectedMovie(movie);
    };
    const img = new Image();
    img.onload = open;
    img.onerror = open;
    img.src = `${IMG_BASE}/w780${movie.backdrop_path}`;
    timerRef.current = setTimeout(open, 500);
  }, []);

  return [selectedMovie, setSelectedMovie];
}

function useSwipeToDismiss(onClose) {
  const startY = useRef(null);
  const currentY = useRef(0);
  const modalRef = useRef(null);
  const overlayRef = useRef(null);
  const isDragging = useRef(false);
  const dismissTimer = useRef(null);
  const closingRef = useRef(false);
  const THRESHOLD = 120;

  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  // Animated close: scale down modal + fade overlay, then unmount
  const animatedClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = modalRef.current;
    const ov = overlayRef.current;
    if (el) {
      el.style.transition = "transform 200ms ease-in, opacity 200ms ease-in";
      el.style.transform = "scale(0.95)";
      el.style.opacity = "0";
    }
    if (ov) {
      ov.style.transition = "opacity 150ms ease-in 50ms";
      ov.style.opacity = "0";
    }
    dismissTimer.current = setTimeout(() => onClose(), 200);
  }, [onClose]);

  const onTouchStart = useCallback((e) => {
    const el = modalRef.current;
    if (!el) return;
    const scrollable = el.querySelector(".modal-body") || el;
    if (scrollable.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    currentY.current = 0;
    isDragging.current = false;
    el.style.transition = "none";
  }, []);

  const onTouchMove = useCallback((e) => {
    if (startY.current === null) return;
    const el = modalRef.current;
    if (!el) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff < 0) { currentY.current = 0; el.style.transform = ""; return; }
    if (diff > 8) isDragging.current = true;
    if (!isDragging.current) return;
    e.preventDefault();
    const resisted = diff < 60 ? diff : 60 + (diff - 60) * 0.4;
    currentY.current = resisted;
    el.style.transform = `translateY(${resisted}px)`;
    if (overlayRef.current) {
      overlayRef.current.style.opacity = Math.max(0.2, 1 - resisted / 400);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const el = modalRef.current;
    if (!el) { startY.current = null; return; }
    const raw = currentY.current;
    startY.current = null;
    if (!isDragging.current) { el.style.transform = ""; return; }
    isDragging.current = false;
    if (raw >= THRESHOLD * 0.4 + 60 * 0.6) {
      el.style.transition = "transform 0.28s cubic-bezier(0.4, 0, 1, 1), opacity 0.28s ease";
      el.style.transform = "translateY(100vh)";
      el.style.opacity = "0";
      if (overlayRef.current) {
        overlayRef.current.style.transition = "opacity 0.28s ease";
        overlayRef.current.style.opacity = "0";
      }
      dismissTimer.current = setTimeout(() => onClose(), 250);
    } else {
      el.style.transition = "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
      el.style.transform = "";
      if (overlayRef.current) {
        overlayRef.current.style.transition = "opacity 0.3s ease";
        overlayRef.current.style.opacity = "";
      }
    }
  }, [onClose]);

  return { modalRef, overlayRef, animatedClose, swipeHandlers: { onTouchStart, onTouchMove, onTouchEnd } };
}

function useScrollRestore(key, scrollPositions, existingRef) {
  const ownRef = useRef(null);
  const ref = existingRef || ownRef;
  useEffect(() => {
    const el = ref.current;
    if (el && scrollPositions.current[key]) {
      el.scrollTop = scrollPositions.current[key];
    }
    return () => {
      if (el) scrollPositions.current[key] = el.scrollTop;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ref;
}

function CinnoLogo({ size = 36 }) {
  const uid = useId();
  const glowId = `cinno-hinge-glow-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id={glowId} cx="0.25" cy="0.48" r="0.15">
          <stop offset="0%" stopColor="#D4B05C" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#D4B05C" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="120" height="120" rx="28" fill="#8B2040"/>
      <circle cx="32" cy="56" r="16" fill={`url(#${glowId})`}/>
      <rect x="32" y="56" width="66" height="34" rx="4" fill="#F5F0EB" opacity="0.04"/>
      <rect x="32" y="56" width="66" height="34" rx="4" fill="none" stroke="#F5F0EB" strokeWidth="8" opacity="0.9"/>
      <line x1="32" y1="56" x2="98" y2="56" stroke="#F5F0EB" strokeWidth="8" opacity="0.9"/>
      <line x1="32" y1="56" x2="96" y2="34" stroke="#F5F0EB" strokeWidth="8" strokeLinecap="round"/>
      <line x1="48" y1="52.5" x2="51" y2="41" stroke="#D4B05C" strokeWidth="2.8" strokeLinecap="round" opacity="0.55"/>
      <line x1="62" y1="50.5" x2="65" y2="39" stroke="#D4B05C" strokeWidth="2.8" strokeLinecap="round" opacity="0.55"/>
      <line x1="76" y1="48.5" x2="79" y2="37" stroke="#D4B05C" strokeWidth="2.8" strokeLinecap="round" opacity="0.55"/>
      <circle cx="32" cy="56" r="4.5" fill="none" stroke="#D4B05C" strokeWidth="2.2" opacity="0.7"/>
      <circle cx="32" cy="56" r="3" fill="#D4B05C"/>
    </svg>
  );
}

const ALL_SUGGESTIONS = [
  { text: "Recommend a thriller", icon: "knife" },
  { text: "Explain Inception's ending", icon: "brain" },
  { text: "Movies like Parasite", icon: "film" },
  { text: "Best films of the 90s", icon: "clock" },
  { text: "Hidden gem dramas", icon: "gem" },
  { text: "What should I watch tonight?", icon: "popcorn" },
  { text: "Movies with great soundtracks", icon: "music" },
  { text: "Underrated sci-fi films", icon: "gem" },
  { text: "Best animated movies ever", icon: "film" },
  { text: "Movies like Interstellar", icon: "film" },
  { text: "Dark comedies worth watching", icon: "masks" },
  { text: "Classic noir films", icon: "film" },
  { text: "Must-see foreign films", icon: "globe" },
  { text: "Best ensemble casts", icon: "people" },
  { text: "Movies that make you think", icon: "brain" },
  { text: "Feel-good films to rewatch", icon: "heart" },
];

const PICKER_SUGGESTIONS = [
  "feeling adrenaline", "cozy night in", "date night picks", "something weird",
  "comfort rewatch", "mind-bending", "group of friends", "solo chill night",
  "need a good cry", "visually stunning", "hidden gem", "90s nostalgia",
];

const DEBRIEF_FOLLOWUPS = [
  ["Was the ending satisfying?", "Best performance?", "Would you rewatch?"],
  ["How does it compare?", "What stood out most?", "Any weak spots?"],
  ["Favorite scene?", "How was the pacing?", "Worth recommending?"],
  ["Did it surprise you?", "What about the soundtrack?", "Rate the directing"],
  ["Which character stood out?", "Better than expected?", "Any plot holes?"],
];

const GENERAL_FOLLOWUPS = [
  ["Recommend something similar", "Explain the plot", "Who directed it?"],
  ["Any hidden gems?", "Best of the decade?", "Similar vibe movies"],
  ["What else should I watch?", "Compare two movies", "Underrated picks"],
  ["Tell me more", "Any controversies?", "Behind the scenes"],
];

const DEBRIEF_OPENERS = [
  (t, s, n) => `I just watched ${t}${s ? ` and rated it ${s}/100` : ""}. ${n || ""} Let's debrief.`,
  (t, s, n) => `Just finished ${t}.${s ? ` I'd give it a ${s}/100.` : ""} ${n ? " " + n : ""} What are your thoughts on it?`,
  (t, s, n) => `${t} — just watched it.${s ? ` Gave it ${s}/100.` : ""} ${n ? " " + n : ""} I need to talk about this one.`,
  (t, s, n) => `Okay I need to talk about ${t}.${s ? ` Rating: ${s}/100.` : ""} ${n ? " " + n : ""} Debrief me.`,
  (t, s, n) => `So I just saw ${t}${s ? ` (${s}/100)` : ""}.${n ? " " + n : ""} Let's break it down.`,
  (t, s, n) => `Just got done watching ${t}.${s ? ` My score: ${s}/100.` : ""} ${n ? " " + n : ""} Talk to me about this film.`,
];

const EMPTY_JOURNAL = [
  { icon: "🍿", title: "No movies here yet", desc: "Your watchlist is judging you silently." },
  { icon: "📽️", title: "Blank reel syndrome", desc: "The projector is ready. You are not." },
  { icon: "🎬", title: "Director's chair is empty", desc: "Mark some movies as watched and take a seat." },
  { icon: "🛋️", title: "Couch is warm, journal is cold", desc: "Go watch something and come back with stories." },
  { icon: "🎞️", title: "Zero movies watched", desc: "Statistically concerning. Emotionally devastating." },
  { icon: "🌙", title: "A quiet night", desc: "No movies logged yet. The screen awaits." },
  { icon: "📼", title: "Rewinding to nothing", desc: "Start watching and your journal fills itself." },
  { icon: "🎭", title: "The curtain hasn't risen", desc: "Your cinematic journey begins with one movie." },
];

const EMPTY_RANKINGS = [
  { icon: "🏆", title: "No rankings yet", desc: "Rate your watched movies to crown a champion." },
  { icon: "📊", title: "The scoreboard is blank", desc: "Watch and rate movies to see who takes the throne." },
  { icon: "🥇", title: "First place is up for grabs", desc: "Your movies are waiting to be ranked." },
  { icon: "⚖️", title: "Nothing to compare", desc: "Rate a few movies and let the battle begin." },
  { icon: "🎯", title: "No scores on the board", desc: "Use the rating slider to rank your watches." },
  { icon: "🗳️", title: "The votes aren't in", desc: "Rate movies in your journal to populate this list." },
  { icon: "📋", title: "Leaderboard loading...", desc: "Just kidding. You need to rate some movies first." },
  { icon: "🔢", title: "Ranking: undefined", desc: "NaN movies rated. Please provide input." },
];

const EMPTY_STATS = [
  { icon: "📈", title: "No data to crunch", desc: "Watch some movies so we have something to graph." },
  { icon: "🔬", title: "Insufficient sample size", desc: "The lab needs more movie data. Get watching." },
  { icon: "🧮", title: "The math isn't mathing", desc: "Zero movies makes for boring statistics." },
  { icon: "📉", title: "Flatline detected", desc: "Your movie activity is clinically zero." },
  { icon: "🗺️", title: "Uncharted territory", desc: "Start logging movies to map your taste." },
  { icon: "🔭", title: "Nothing to observe", desc: "We need movie data before the charts come alive." },
  { icon: "🧪", title: "Experiment needs subjects", desc: "Add watched movies to begin the analysis." },
  { icon: "💤", title: "Stats are sleeping", desc: "Wake them up by watching and rating films." },
];

const EMPTY_WATCHLIST = [
  { icon: "🔖", title: "Nothing saved yet", desc: "Bookmark movies you want to watch later." },
  { icon: "📌", title: "Your list is wide open", desc: "Tap the bookmark icon on any movie to pin it here." },
  { icon: "🗂️", title: "Empty folder energy", desc: "Start saving movies and build your queue." },
  { icon: "🎟️", title: "No tickets punched", desc: "Find something that catches your eye and save it." },
  { icon: "📭", title: "Mailbox is empty", desc: "No movies saved. The postman is disappointed." },
  { icon: "🏜️", title: "It's a desert in here", desc: "Save some movies to bring this place to life." },
  { icon: "🧊", title: "Frozen in time", desc: "Your watchlist is waiting for its first entry." },
  { icon: "🪹", title: "Empty nest", desc: "This list needs some movies to call home." },
];

const MILESTONE_THRESHOLDS = [10, 25, 50, 100, 250];
const MILESTONE_MESSAGES = {
  10: "You're building a real collection!",
  25: "A quarter-century of cinema logged!",
  50: "Half a hundred films deep!",
  100: "Triple digits — a true cinephile!",
  250: "Legendary status achieved!",
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}


const GENRE_FILTERS = [
  { id: 28,    label: "Action"      },
  { id: 35,    label: "Comedy"      },
  { id: 18,    label: "Drama"       },
  { id: 27,    label: "Horror"      },
  { id: 878,   label: "Sci-Fi"      },
  { id: 53,    label: "Thriller"    },
  { id: 10749, label: "Romance"     },
  { id: 16,    label: "Animation"   },
  { id: 12,    label: "Adventure"   },
  { id: 14,    label: "Fantasy"     },
  { id: 9648,  label: "Mystery"     },
  { id: 99,    label: "Documentary" },
];

function getRatingColor(r) {
  const n = parseFloat(r);
  return n >= 7 ? "var(--rating-high)" : n >= 5 ? "var(--rating-mid)" : "var(--rating-low)";
}

function getScoreColor(score) {
  if (score >= 85) return "#5cb85c";
  if (score >= 70) return "#8bbd5c";
  if (score >= 60) return "#b8c94a";
  if (score >= 50) return "#e6b830";
  if (score >= 40) return "#e6853a";
  if (score >= 20) return "#c85a2a";
  return "#c84040";
}

function ScoreRing({ score, size = 44 }) {
  const strokeWidth = size >= 52 ? 5 : 4;
  const radius = (size - strokeWidth * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - (score ?? 0) / 100);
  const color = score ? getScoreColor(score) : null;
  const fontSize = size >= 52 ? 13 : 11;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      {score && (
        <circle
          cx={cx} cy={cy} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
      <text
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={score ? color : "var(--text-muted)"}
        fontSize={fontSize}
        fontWeight="700"
        fontFamily="Plus Jakarta Sans, sans-serif"
      >
        {score ?? "—"}
      </text>
    </svg>
  );
}

// ─── User-Scoped localStorage ─────────────────────────────────────────────────
// When a user is logged in, all user-data keys are prefixed with their Supabase
// user ID so data persists across sign-out / sign-in cycles.  Guest mode uses
// non-prefixed keys.  Theme is never scoped (shared across sessions).

let _storageUserId = null;
const NON_SCOPED_KEYS = new Set(["cc_theme"]);

function scopedKey(key) {
  if (!_storageUserId || NON_SCOPED_KEYS.has(key)) return key;
  return `${_storageUserId}_${key}`;
}

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(scopedKey(key));
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key, value) {
  try {
    localStorage.setItem(scopedKey(key), JSON.stringify(value));
  } catch (e) {
    console.error("localStorage save failed:", e);
  }
}

function removeFromStorage(key) {
  try { localStorage.removeItem(scopedKey(key)); } catch {}
}

// All keys that hold user-specific data (everything except cc_theme)
const USER_DATA_KEYS = [
  "cc_savedIds", "cc_savedMovies", "cc_watchedIds", "cc_watchedMovies",
  "cc_watchedNotes", "cc_watchedRatings", "cc_tasteProfile", "cc_collections",
  "cc_badges", "cc_watchedDates", "cc_chats", "cc_activeChatId",
  "cc_upNextId", "cc_stats_pinned", "cc_rankSort", "cc_journalSort",
  "cc_runtimeCache", "cc_discover_maybe_later", "cc_shownMilestones",
  "cc_aiInsight", "cc_moodPlaylist", "cc_discover_swipe_weights",
  "cc_discover_seen", "cc_discover_swipe_history", "cinno-smart-mode",
  "cc_badge_showcase",
];

// On first login: migrate any non-prefixed (pre-auth or guest) data to user-scoped keys
function migrateGuestDataToUser(userId) {
  // If user already has scoped data, skip — don't overwrite
  if (USER_DATA_KEYS.some((k) => localStorage.getItem(`${userId}_${k}`) !== null)) return;
  // If no non-prefixed data exists, nothing to migrate
  if (!USER_DATA_KEYS.some((k) => localStorage.getItem(k) !== null)) return;
  // Copy non-prefixed → prefixed, then delete originals
  USER_DATA_KEYS.forEach((k) => {
    const val = localStorage.getItem(k);
    if (val !== null) {
      localStorage.setItem(`${userId}_${k}`, val);
      localStorage.removeItem(k);
    }
  });
}

// ─── SVG Icons ─────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const BookmarkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

const FilmStripIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="1" />
    <line x1="7" y1="4" x2="7" y2="20" />
    <line x1="17" y1="4" x2="17" y2="20" />
    <line x1="2" y1="9" x2="7" y2="9" />
    <line x1="17" y1="9" x2="22" y2="9" />
    <line x1="2" y1="15" x2="7" y2="15" />
    <line x1="17" y1="15" x2="22" y2="15" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="15" y2="12" /><line x1="3" y1="18" x2="18" y2="18" />
  </svg>
);

const BotIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </svg>
);

const PersonIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const GearIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const PopcornIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 8h10l-1.5 13H8.5L7 8z" />
    <path d="M7 8a3 3 0 015-2.2A3 3 0 0117 8" />
    <path d="M7 8a3 3 0 01-.5-4.5A3 3 0 019.5 4" />
    <path d="M17 8a3 3 0 00.5-4.5A3 3 0 0014.5 4" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
  </svg>
);

const DiscoverIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="15" height="18" rx="2.5" />
    <rect x="7" y="2" width="15" height="18" rx="2.5" opacity="0.4" />
  </svg>
);

const SwipeHeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
  </svg>
);

const SwipeXIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

const UndoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
  </svg>
);

const ShuffleIcon = ({ size = 18, style }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: size, height: size, ...style }}>
    <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
);

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
  </svg>
);

const StarIconSolid = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const TrophyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9H4a2 2 0 01-2-2V5a2 2 0 012-2h2" /><path d="M18 9h2a2 2 0 002-2V5a2 2 0 00-2-2h-2" />
    <path d="M4 22h16" /><path d="M10 22V14a2 2 0 00-2-2H6V3h12v9h-2a2 2 0 00-2 2v8" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0110 0v4" />
  </svg>
);

// ─── Badge Icons (each unique per badge) ────────────────────────────────────────
const BadgeIconFirstWatch = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" />
    <polygon points="20,10 22.5,17 30,17 24,21.5 26,29 20,24.5 14,29 16,21.5 10,17 17.5,17" fill="currentColor" opacity="0.85" />
  </svg>
);

const BadgeIconCritic = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <rect x="8" y="12" width="24" height="17" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 19h12M14 23h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="28" cy="12" r="4" fill="currentColor" opacity="0.3" />
    <path d="M26.5 12l1 1 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BadgeIconHorror = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <path d="M20 6c-6 0-11 4-11 11 0 4 2 7 4 9 1.5 1.5 2 3 2 5h10c0-2 .5-3.5 2-5 2-2 4-5 4-9 0-7-5-11-11-11z" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="15" cy="18" r="2" fill="currentColor" />
    <circle cx="25" cy="18" r="2" fill="currentColor" />
    <path d="M14 24h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M16 24v3M20 24v3M24 24v3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const BadgeIconCentury = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <rect x="6" y="8" width="28" height="24" rx="3" stroke="currentColor" strokeWidth="1.5" />
    <text x="20" y="24" textAnchor="middle" fill="currentColor" fontSize="12" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">100</text>
    <path d="M6 14h28" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const BadgeIconPerfectionist = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="13" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="20" cy="20" r="8" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
    <circle cx="20" cy="20" r="3" fill="currentColor" />
    <path d="M20 7v3M20 30v3M7 20h3M30 20h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
  </svg>
);

const BadgeIconExplorer = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 14l4 8 8-4-4-8z" fill="currentColor" opacity="0.25" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="20" cy="20" r="2" fill="currentColor" />
  </svg>
);

const BadgeIconBinge = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <rect x="7" y="10" width="10" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <rect x="15" y="8" width="10" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <rect x="23" y="10" width="10" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M12 30l3-3M20 28l0-3M28 30l-3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const BadgeIconCollector = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <rect x="6" y="14" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.2" />
    <rect x="14" y="10" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.1" />
    <rect x="22" y="14" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="1.2" />
    <path d="M18 17h4M18 20h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

const BadgeIconNightOwl = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="22" r="12" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="16" cy="19" r="2.5" fill="currentColor" />
    <circle cx="24" cy="19" r="2.5" fill="currentColor" />
    <path d="M14 26c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M8 12c2-3 5-5 9-5 1.5 0 3 .3 4 .8M28 8c1 1.5 1.5 3 1.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    <circle cx="10" cy="8" r="1.5" fill="currentColor" opacity="0.3" />
    <circle cx="32" cy="12" r="1" fill="currentColor" opacity="0.3" />
    <circle cx="28" cy="6" r="1.2" fill="currentColor" opacity="0.3" />
  </svg>
);

const BadgeIconMarathon = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <rect x="4" y="14" width="7" height="11" rx="1" stroke="currentColor" strokeWidth="1" />
    <rect x="12" y="12" width="7" height="13" rx="1" stroke="currentColor" strokeWidth="1" />
    <rect x="20" y="10" width="7" height="15" rx="1" stroke="currentColor" strokeWidth="1" fill="currentColor" fillOpacity="0.1" />
    <rect x="28" y="12" width="7" height="13" rx="1" stroke="currentColor" strokeWidth="1" />
    <path d="M7 30h26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
    <path d="M20 28v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const BadgeIconContrarian = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="14" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 24l6-14 6 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M26 16l-6 14-6-14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3" />
  </svg>
);

const BadgeIconDebrief = () => (
  <svg viewBox="0 0 40 40" fill="none">
    <rect x="8" y="8" width="24" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M14 15h12M14 19h8M14 23h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
    <path d="M20 28l-4 4v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ─── Badge Definitions (Tiered) ─────────────────────────────────────────────────
const ALL_GENRES = Object.keys(GENRE_COLORS).filter((g) => g !== "Film");

const TIER_COLORS = {
  bronze: "#B87333",
  silver: "#A8A8A8",
  gold:   "#D4A843",
};

const BADGE_DEFS = [
  { id: "first_watch",    title: "First Watch",   desc: "Movies watched",          tiers: [1, 5, 10],   icon: BadgeIconFirstWatch },
  { id: "critic",         title: "Critic",         desc: "Movies rated",            tiers: [5, 25, 100], icon: BadgeIconCritic },
  { id: "horror_fan",     title: "Horror Fan",     desc: "Horror movies watched",   tiers: [3, 10, 25],  icon: BadgeIconHorror },
  { id: "binge_watcher",  title: "Binge Watcher",  desc: "Movies in one day",       tiers: [2, 3, 5],    icon: BadgeIconBinge },
  { id: "collector",      title: "Collector",       desc: "Collections created",     tiers: [2, 5, 10],   icon: BadgeIconCollector },
  { id: "genre_explorer", title: "Explorer",        desc: "Genres watched",          tiers: [3, 6, 10],   icon: BadgeIconExplorer },
  // Secret badges
  { id: "night_owl",      title: "Night Owl",      desc: "Late-night movies",       tiers: [3, 8, 15],   icon: BadgeIconNightOwl,   secret: true },
  { id: "marathon_runner", title: "Marathon Runner", desc: "Movies in one day",      tiers: [5, 7, 10],   icon: BadgeIconMarathon,   secret: true },
  { id: "contrarian",     title: "The Contrarian",  desc: "Disagree with TMDB",     tiers: [3, 8, 15],   icon: BadgeIconContrarian, secret: true },
  { id: "first_debrief",  title: "Debriefer",       desc: "AI debriefs completed",  tiers: [1, 5, 10],   icon: BadgeIconDebrief,    secret: true },
];

function maxMoviesInOneDay(watchedDates) {
  const dayCounts = {};
  watchedDates.forEach((dateStr) => { const day = dateStr.slice(0, 10); dayCounts[day] = (dayCounts[day] || 0) + 1; });
  return Object.values(dayCounts).reduce((mx, v) => Math.max(mx, v), 0);
}

function computeBadgeProgress(badgeId, { watchedMovies, watchedRatings, collections, watchedDates, chats }) {
  switch (badgeId) {
    case "first_watch":    return watchedMovies.size;
    case "critic":         return watchedRatings.size;
    case "horror_fan": {
      let count = 0;
      watchedMovies.forEach((m) => { if (m.genre === "Horror") count++; });
      return count;
    }
    case "binge_watcher":
    case "marathon_runner":
      return maxMoviesInOneDay(watchedDates);
    case "collector": {
      return collections.filter((c) => !c.isDefault).length;
    }
    case "genre_explorer": {
      const seen = new Set();
      watchedMovies.forEach((m) => { if (m.genre && m.genre !== "Film") seen.add(m.genre); });
      return seen.size;
    }
    case "night_owl": {
      let count = 0;
      watchedDates.forEach((dateStr) => {
        if (typeof dateStr !== "string") return;
        const hour = parseInt(dateStr.slice(11, 13));
        if (hour >= 23 || hour < 5) count++;
      });
      return count;
    }
    case "contrarian": {
      let count = 0;
      watchedRatings.forEach((userScore, id) => {
        const movie = watchedMovies.get(id);
        if (movie?.rating && movie.rating !== "—") {
          const tmdbScore = parseFloat(movie.rating) * 10;
          if (Math.abs(userScore - tmdbScore) > 30) count++;
        }
      });
      return count;
    }
    case "first_debrief": {
      return (chats || []).filter((c) => c.messages && c.messages.length >= 2).length;
    }
    default: return 0;
  }
}

// Returns: 0 = none, 1 = bronze, 2 = silver, 3 = gold
function getBadgeTier(progress, tiers) {
  if (progress >= tiers[2]) return 3;
  if (progress >= tiers[1]) return 2;
  if (progress >= tiers[0]) return 1;
  return 0;
}

const TIER_NAMES = ["", "Bronze", "Silver", "Gold"];

const BADGE_RARITY = {
  first_watch:     { 1: { label: "Common",    pct: 95, color: "#7A7878" }, 2: { label: "Uncommon", pct: 55, color: "#4CAF50" }, 3: { label: "Rare",      pct: 18, color: "#2196F3" } },
  critic:          { 1: { label: "Uncommon",  pct: 40, color: "#4CAF50" }, 2: { label: "Rare",     pct: 12, color: "#2196F3" }, 3: { label: "Epic",      pct: 3,  color: "#9C27B0" } },
  horror_fan:      { 1: { label: "Uncommon",  pct: 35, color: "#4CAF50" }, 2: { label: "Rare",     pct: 12, color: "#2196F3" }, 3: { label: "Epic",      pct: 4,  color: "#9C27B0" } },
  binge_watcher:   { 1: { label: "Uncommon",  pct: 30, color: "#4CAF50" }, 2: { label: "Rare",     pct: 15, color: "#2196F3" }, 3: { label: "Epic",      pct: 5,  color: "#9C27B0" } },
  collector:       { 1: { label: "Common",    pct: 50, color: "#7A7878" }, 2: { label: "Uncommon", pct: 25, color: "#4CAF50" }, 3: { label: "Rare",      pct: 8,  color: "#2196F3" } },
  genre_explorer:  { 1: { label: "Common",    pct: 60, color: "#7A7878" }, 2: { label: "Uncommon", pct: 30, color: "#4CAF50" }, 3: { label: "Epic",      pct: 5,  color: "#9C27B0" } },
  night_owl:       { 1: { label: "Rare",      pct: 12, color: "#2196F3" }, 2: { label: "Epic",     pct: 5,  color: "#9C27B0" }, 3: { label: "Legendary", pct: 2,  color: "#D4A843" } },
  marathon_runner: { 1: { label: "Rare",      pct: 10, color: "#2196F3" }, 2: { label: "Epic",     pct: 3,  color: "#9C27B0" }, 3: { label: "Legendary", pct: 1,  color: "#D4A843" } },
  contrarian:      { 1: { label: "Uncommon",  pct: 25, color: "#4CAF50" }, 2: { label: "Rare",     pct: 10, color: "#2196F3" }, 3: { label: "Epic",      pct: 3,  color: "#9C27B0" } },
  first_debrief:   { 1: { label: "Uncommon",  pct: 40, color: "#4CAF50" }, 2: { label: "Rare",     pct: 15, color: "#2196F3" }, 3: { label: "Epic",      pct: 5,  color: "#9C27B0" } },
};

const SECRET_HINTS = {
  night_owl: "Keep exploring different hours...",
  marathon_runner: "Can you watch even more in one day?",
  contrarian: "Trust your own ratings...",
  first_debrief: "Have you tried the AI chat?",
};

const MASTERY_LEVELS = [
  { min: 0,  label: "Novice" },
  { min: 5,  label: "Fan" },
  { min: 10, label: "Enthusiast" },
  { min: 20, label: "Master" },
];

function getMasteryLevel(count) {
  for (let i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
    if (count >= MASTERY_LEVELS[i].min) return MASTERY_LEVELS[i];
  }
  return MASTERY_LEVELS[0];
}

function getMasteryMax(count) {
  if (count >= 20) return 20;
  if (count >= 10) return 20;
  if (count >= 5) return 10;
  return 5;
}

// ─── Shared Components ─────────────────────────────────────────────────────────

function Skeleton({ width, height, radius = 6, style, className = "" }) {
  return (
    <div
      className={`skel ${className}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

function SkeletonGrid({ count = 12 }) {
  return (
    <div className="movies-grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-tile">
          <div className="skeleton-poster" />
          <div className="skeleton-title" />
        </div>
      ))}
    </div>
  );
}

function SkeletonScrollRow({ count = 8 }) {
  return Array.from({ length: count }, (_, i) => (
    <div key={i} className="skeleton-tile scroll-tile" />
  ));
}

function SkeletonModalBody() {
  return (
    <div className="skel-modal-body">
      <div className="skel-modal-top">
        <Skeleton width={100} height={150} radius={10} />
        <div className="skel-modal-info">
          <Skeleton width="75%" height={20} radius={4} />
          <div className="skel-modal-meta-row">
            <Skeleton width={40} height={14} radius={4} />
            <Skeleton width={50} height={14} radius={4} />
            <Skeleton width={60} height={22} radius={12} />
          </div>
          <Skeleton width={56} height={14} radius={4} />
          <div className="skel-modal-meta-row" style={{ marginTop: 10 }}>
            <Skeleton width={80} height={32} radius={8} />
            <Skeleton width={100} height={32} radius={8} />
          </div>
        </div>
      </div>
      <div className="skel-modal-tabs">
        <Skeleton width={70} height={14} radius={4} />
        <Skeleton width={90} height={14} radius={4} />
      </div>
      <Skeleton width="100%" height={12} radius={4} style={{ marginTop: 16 }} />
      <Skeleton width="100%" height={12} radius={4} style={{ marginTop: 8 }} />
      <Skeleton width="65%" height={12} radius={4} style={{ marginTop: 8 }} />
    </div>
  );
}

function SkeletonChatBubbles() {
  return (
    <div className="skel-chat-lines">
      <Skeleton width="90%" height={12} radius={4} />
      <Skeleton width="70%" height={12} radius={4} />
      <Skeleton width="40%" height={12} radius={4} />
    </div>
  );
}

function PosterImage({ posterPath, title }) {
  if (!posterPath) return <span className="movie-poster-fallback">🎬</span>;
  return <img src={`${IMG_BASE}/w342${posterPath}`} alt={title} loading="lazy" />;
}

function ScrollRow({ children }) {
  const rowRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const scrollStart = useRef(0);
  const hasDragged = useRef(false);

  const update = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", update); ro.disconnect(); };
  }, [update, children]);

  const scroll = (dir) => {
    const el = rowRef.current;
    if (!el) return;
    const tile = el.querySelector(".scroll-tile");
    const style = tile ? getComputedStyle(el.querySelector(".scroll-row-inner")) : null;
    const gap = style ? parseFloat(style.gap) || 12 : 12;
    const cardW = tile ? tile.offsetWidth + gap : 140;
    // Disable snap during programmatic scroll so it lands exactly 3 cards over
    el.style.scrollSnapType = "none";
    el.scrollBy({ left: dir * cardW * 3, behavior: "smooth" });
    setTimeout(() => { if (el) el.style.scrollSnapType = ""; }, 500);
  };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragging.current = true;
    hasDragged.current = false;
    startX.current = e.clientX;
    scrollStart.current = rowRef.current.scrollLeft;
    rowRef.current.style.cursor = "grabbing";
    rowRef.current.style.userSelect = "none";
    rowRef.current.style.scrollBehavior = "auto";
    rowRef.current.style.scrollSnapType = "none";
  };

  const onMouseMove = (e) => {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 4) hasDragged.current = true;
    rowRef.current.scrollLeft = scrollStart.current - dx;
  };

  const onMouseUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    rowRef.current.style.cursor = "";
    rowRef.current.style.userSelect = "";
    rowRef.current.style.scrollBehavior = "";
    rowRef.current.style.scrollSnapType = "";
    if (hasDragged.current) {
      const blocker = (e) => { e.stopPropagation(); e.preventDefault(); };
      rowRef.current.addEventListener("click", blocker, { capture: true, once: true });
      setTimeout(() => rowRef.current?.removeEventListener("click", blocker, { capture: true }), 50);
    }
  };

  useEffect(() => {
    const up = () => {
      if (dragging.current && rowRef.current) {
        dragging.current = false;
        rowRef.current.style.cursor = "";
        rowRef.current.style.userSelect = "";
        rowRef.current.style.scrollBehavior = "";
        rowRef.current.style.scrollSnapType = "";
      }
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  return (
    <div className="scroll-row-wrap">
      <button className={`scroll-arrow scroll-arrow-left${canLeft ? " visible" : ""}`} onClick={() => scroll(-1)} aria-label="Scroll left">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div
        className="scroll-row"
        ref={rowRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <div className="scroll-row-inner">
          {children}
        </div>
      </div>
      <button className={`scroll-arrow scroll-arrow-right${canRight ? " visible" : ""}`} onClick={() => scroll(1)} aria-label="Scroll right">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg>
      </button>
    </div>
  );
}

function MovieTile({ movie, onClick, isSaved, onToggleSave, className, style }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#7A7878";
  return (
    <div className={`movie-tile ${className || ""}`} onClick={onClick} style={style}>
      <div className="movie-poster">
        <PosterImage posterPath={movie.poster_path} title={movie.title} />
        <span className="movie-poster-rating">★ {movie.rating}</span>
      </div>
      <button
        className={`save-btn ${isSaved ? "saved" : ""}`}
        onClick={(e) => { e.stopPropagation(); onToggleSave(movie); }}
        title={isSaved ? "Remove from watchlist" : "Add to watchlist"}
      >
        <BookmarkIcon />
      </button>
      <div className="movie-tile-title">{movie.title}</div>
      <div className="movie-tile-genre" style={{ color: genreColor }}>{movie.genre}</div>
    </div>
  );
}

function formatRuntime(minutes) {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const MODAL_TAB_ORDER = { overview: 0, similar: 1, notes: 1 };

function useTabDirection(tab) {
  const prevRef = useRef(tab);
  const [dir, setDir] = useState(null);
  useEffect(() => {
    if (prevRef.current !== tab) {
      setDir((MODAL_TAB_ORDER[tab] ?? 0) > (MODAL_TAB_ORDER[prevRef.current] ?? 0) ? "right" : "left");
      prevRef.current = tab;
    }
  }, [tab]);
  return dir;
}

function MovieModal({ movie, onClose, isSaved, onToggleSave, onMovieSelect, savedIds, isWatched, onToggleWatched, onStartDebrief, collections, toggleMovieInCollection, rating, onSetRating }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#7A7878";
  const ratingColor = getRatingColor(movie.rating);
  const [tab, setTab] = useState("overview");
  const tabDir = useTabDirection(tab);
  const [similar, setSimilar] = useState([]);
  const [similarLoaded, setSimilarLoaded] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [backdropLoaded, setBackdropLoaded] = useState(false);
  const [collectionDropdown, setCollectionDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const collectionFloating = useFloating({
    open: collectionDropdown,
    placement: "top-start",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!collectionDropdown) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setCollectionDropdown(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [collectionDropdown]);

  useEffect(() => {
    setProvidersLoading(true);
    getWatchProviders(movie.id).then(setProviders).catch(() => {}).finally(() => setProvidersLoading(false));
    setDetailsLoading(true);
    getMovieDetails(movie.id).then(setDetails).catch(() => {}).finally(() => setDetailsLoading(false));
  }, [movie.id]);

  const loadSimilar = async () => {
    if (similarLoaded) return;
    setLoadingSimilar(true);
    try {
      const data = await getSimilar(movie.id);
      setSimilar(data);
      setSimilarLoaded(true);
    } catch (e) {
      console.error("Similar fetch failed:", e);
    } finally {
      setLoadingSimilar(false);
    }
  };

  const handleTabSwitch = (t) => {
    setTab(t);
    if (t === "similar") loadSimilar();
  };

  const backdropPath = movie.backdrop_path || (details?.backdrop_path ?? null);
  const backdropUrl = backdropPath ? `${IMG_BASE}/w780${backdropPath}` : null;
  const posterBlurUrl = movie.poster_path ? `${IMG_BASE}/w342${movie.poster_path}` : null;
  const { modalRef, overlayRef, animatedClose, swipeHandlers } = useSwipeToDismiss(onClose);

  return createPortal(
    <div className="movie-modal-overlay" ref={overlayRef} onClick={animatedClose}>
      <div className="movie-modal movie-modal-lg" ref={modalRef} {...swipeHandlers} onClick={(e) => e.stopPropagation()}>
        {posterBlurUrl && <div className="modal-poster-bg" style={{ backgroundImage: `url(${posterBlurUrl})` }} />}
        <div className="modal-handle-bar">
          <div className="modal-handle" />
        </div>
        <button className="modal-close-btn" onClick={animatedClose}>✕</button>
        <div className="modal-backdrop">
          {backdropUrl ? (
            <>
              {!backdropLoaded && posterBlurUrl && (
                <div className="modal-backdrop-blur" style={{ backgroundImage: `url(${posterBlurUrl})` }} />
              )}
              <img
                src={backdropUrl}
                alt={movie.title}
                onLoad={() => setBackdropLoaded(true)}
                className={backdropLoaded ? "loaded" : ""}
              />
            </>
          ) : (
            <div className="modal-backdrop-placeholder" style={{ background: `${genreColor}22` }} />
          )}
          <div className="modal-backdrop-fade" />
        </div>
        <div className="modal-body">
          <div className="modal-top-row">
            <div className="modal-poster">
              <PosterImage posterPath={movie.poster_path} title={movie.title} />
            </div>
            <div className="modal-info">
              <div className="modal-title">{movie.title}</div>
              <div className="modal-meta">
                <span className="modal-year">{movie.year}</span>
                <span className="modal-rating" style={{ color: ratingColor }}>★ {movie.rating}</span>
                <span className="modal-genre" style={{ color: genreColor, background: genreColor + "18" }}>
                  {movie.genre}
                </span>
              </div>
              {detailsLoading ? (
                <Skeleton width={56} height={14} radius={4} style={{ marginTop: 2 }} />
              ) : details?.runtime ? (
                <span className="modal-runtime">{formatRuntime(details.runtime)}</span>
              ) : null}
              <div className="modal-actions">
                <button className={`modal-save-btn ${isSaved ? "saved" : ""}`} onClick={() => onToggleSave(movie)}>
                  <BookmarkIcon />
                  {isSaved ? "Saved" : "Save"}
                </button>
                <button className={`modal-watch-btn ${isWatched ? "watched" : ""}`} onClick={() => onToggleWatched(movie)}>
                  <EyeIcon />
                  {isWatched ? "Watched" : "Mark watched"}
                </button>
                {isWatched && onStartDebrief && (
                  <button className="modal-debrief-btn" onClick={() => onStartDebrief(movie)}>
                    <ChatIcon />
                    Debrief
                  </button>
                )}
                {collections && toggleMovieInCollection && (
                  <div className="collection-dropdown-wrap" ref={dropdownRef}>
                    <button className="modal-collection-btn" ref={collectionFloating.refs.setReference} onClick={() => setCollectionDropdown((v) => !v)}>
                      <FolderIcon />
                      Collection
                    </button>
                    {collectionDropdown && (
                      <div className="collection-dropdown" ref={collectionFloating.refs.setFloating} style={collectionFloating.floatingStyles}>
                        {collections.map((col) => {
                          const inCol = col.movieIds.includes(movie.id);
                          return (
                            <button
                              key={col.id}
                              className={`collection-dropdown-item ${inCol ? "active" : ""}`}
                              onClick={() => toggleMovieInCollection(col.id, movie)}
                            >
                              <span className="collection-dropdown-check">{inCol ? <CheckIcon /> : null}</span>
                              <span className="collection-dropdown-name">{col.name}</span>
                              <span className="collection-dropdown-count">{col.movieIds.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {isWatched && onSetRating && (
            <div className="rating-section">
              <ScoreRing score={rating} size={56} />
              <div className="rating-controls">
                <div className="rating-label">Your rating{rating ? ` · ${rating}/100` : ""}</div>
                <input
                  type="range"
                  className="rating-slider"
                  min="1"
                  max="100"
                  value={rating ?? 50}
                  onChange={(e) => onSetRating(movie.id, Number(e.target.value))}
                  onPointerUp={() => Toast.fire({ icon: "success", title: "Rating updated" })}
                />
              </div>
              {rating && (
                <button className="rating-clear" onClick={() => onSetRating(movie.id, null)}>✕</button>
              )}
            </div>
          )}
          <div className="modal-tabs">
            <button className={`modal-tab ${tab === "overview" ? "active" : ""}`} onClick={() => handleTabSwitch("overview")}>Overview</button>
            <button className={`modal-tab ${tab === "similar" ? "active" : ""}`} onClick={() => handleTabSwitch("similar")}>Similar to this</button>
          </div>
          <div className={`modal-tab-content ${tabDir ? `slide-${tabDir}` : ""}`} key={tab}>
            {tab === "overview" && (
              <>
                {detailsLoading ? (
                  <Skeleton width="60%" height={14} radius={4} style={{ marginBottom: 8 }} />
                ) : details?.tagline ? (
                  <p className="modal-tagline">{details.tagline}</p>
                ) : null}
                <p className="modal-synopsis">{movie.synopsis}</p>
                {providersLoading ? (
                  <div className="watch-providers">
                    <div className="watch-providers-label">Available on</div>
                    <div className="watch-providers-row">
                      {Array.from({ length: 4 }, (_, i) => (
                        <div key={i} className="watch-provider-skeleton" />
                      ))}
                    </div>
                  </div>
                ) : providers.length > 0 && (
                  <div className="watch-providers">
                    <div className="watch-providers-label">Available on</div>
                    <div className="watch-providers-row">
                      {providers.map((p) => (
                        <img
                          key={p.provider_id}
                          className="watch-provider-logo"
                          src={`${IMG_BASE}/w92${p.logo_path}`}
                          alt={p.provider_name}
                          title={p.provider_name}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === "similar" && (
              <div className="modal-similar">
                {loadingSimilar ? (
                  <div className="skel-similar-grid">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="skel-similar-tile">
                        <Skeleton className="skel-similar-poster" width="100%" height="auto" radius={10} style={{ aspectRatio: "2/3" }} />
                        <Skeleton className="skel-similar-title" width="70%" height={10} radius={5} />
                      </div>
                    ))}
                  </div>
                ) : similar.length === 0 && similarLoaded ? (
                  <div className="no-results"><p>No similar movies found.</p></div>
                ) : (
                  <div className="movies-grid">
                    {similar.map((m, i) => (
                      <MovieTile
                        key={m.id}
                        movie={{ ...m, _idx: i }}
                        isSaved={savedIds ? savedIds.has(m.id) : false}
                        onToggleSave={onToggleSave}
                        onClick={() => onMovieSelect(m)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function JournalDetailModal({ movie, onClose, note, onSaveNote, isSaved, onToggleSave, onToggleWatched, rating, onSetRating, onStartDebrief }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#7A7878";
  const ratingColor = getRatingColor(movie.rating);
  const [tab, setTab] = useState("overview");
  const tabDir = useTabDirection(tab);
  const [noteText, setNoteText] = useState(note || "");
  const [providers, setProviders] = useState([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [backdropLoaded, setBackdropLoaded] = useState(false);
  const posterBlurUrl = movie.poster_path ? `${IMG_BASE}/w342${movie.poster_path}` : null;

  useEffect(() => {
    setProvidersLoading(true);
    getWatchProviders(movie.id).then(setProviders).catch(() => {}).finally(() => setProvidersLoading(false));
    setDetailsLoading(true);
    getMovieDetails(movie.id).then(setDetails).catch(() => {}).finally(() => setDetailsLoading(false));
  }, [movie.id]);

  const backdropPath = movie.backdrop_path || (details?.backdrop_path ?? null);
  const backdropUrl = backdropPath ? `${IMG_BASE}/w780${backdropPath}` : null;

  const saveNote = useCallback(() => onSaveNote(movie.id, noteText), [movie.id, noteText, onSaveNote]);

  const handleTabSwitch = (t) => {
    if (tab === "notes") saveNote();
    setTab(t);
  };

  const { modalRef, overlayRef, animatedClose, swipeHandlers } = useSwipeToDismiss(onClose);

  return createPortal(
    <div className="movie-modal-overlay" ref={overlayRef} onClick={animatedClose}>
      <div className="movie-modal movie-modal-lg" ref={modalRef} {...swipeHandlers} onClick={(e) => e.stopPropagation()}>
        {posterBlurUrl && <div className="modal-poster-bg" style={{ backgroundImage: `url(${posterBlurUrl})` }} />}
        <div className="modal-handle-bar">
          <div className="modal-handle" />
        </div>
        <button className="modal-close-btn" onClick={animatedClose}>✕</button>
        <div className="modal-backdrop">
          {backdropUrl ? (
            <>
              {!backdropLoaded && posterBlurUrl && (
                <div className="modal-backdrop-blur" style={{ backgroundImage: `url(${posterBlurUrl})` }} />
              )}
              <img
                src={backdropUrl}
                alt={movie.title}
                onLoad={() => setBackdropLoaded(true)}
                className={backdropLoaded ? "loaded" : ""}
              />
            </>
          ) : (
            <div className="modal-backdrop-placeholder" style={{ background: `${genreColor}22` }} />
          )}
          <div className="modal-backdrop-fade" />
        </div>
        <div className="modal-body">
          <div className="modal-top-row">
            <div className="modal-poster">
              <PosterImage posterPath={movie.poster_path} title={movie.title} />
            </div>
            <div className="modal-info">
              <div className="modal-title">{movie.title}</div>
              <div className="modal-meta">
                <span className="modal-year">{movie.year}</span>
                <span className="modal-rating" style={{ color: ratingColor }}>★ {movie.rating}</span>
                <span className="modal-genre" style={{ color: genreColor, background: genreColor + "18" }}>
                  {movie.genre}
                </span>
              </div>
              {detailsLoading ? (
                <Skeleton width={56} height={14} radius={4} style={{ marginTop: 2 }} />
              ) : details?.runtime ? (
                <span className="modal-runtime">{formatRuntime(details.runtime)}</span>
              ) : null}
              <div className="modal-actions">
                <button className={`modal-save-btn ${isSaved ? "saved" : ""}`} onClick={() => onToggleSave(movie)}>
                  <BookmarkIcon />
                  {isSaved ? "Saved" : "Save"}
                </button>
                <button className="modal-watch-btn watched" onClick={() => onToggleWatched(movie)}>
                  <EyeIcon />
                  Watched
                </button>
                {onStartDebrief && (
                  <button className="modal-debrief-btn" onClick={() => onStartDebrief(movie)}>
                    <ChatIcon />
                    Debrief
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="rating-section">
            <ScoreRing score={rating} size={56} />
            <div className="rating-controls">
              <div className="rating-label">Your rating{rating ? ` · ${rating}/100` : ""}</div>
              <input
                type="range"
                className="rating-slider"
                min="1"
                max="100"
                value={rating ?? 50}
                onChange={(e) => onSetRating(movie.id, Number(e.target.value))}
                onPointerUp={() => Toast.fire({ icon: "success", title: "Rating updated" })}
              />
            </div>
            {rating && (
              <button className="rating-clear" onClick={() => onSetRating(movie.id, null)}>✕</button>
            )}
          </div>
          <div className="modal-tabs">
            <button className={`modal-tab ${tab === "overview" ? "active" : ""}`} onClick={() => handleTabSwitch("overview")}>Overview</button>
            <button className={`modal-tab ${tab === "notes" ? "active" : ""}`} onClick={() => handleTabSwitch("notes")}>Notes</button>
          </div>
          <div className={`modal-tab-content ${tabDir ? `slide-${tabDir}` : ""}`} key={tab}>
            {tab === "overview" && (
              <>
                {detailsLoading ? (
                  <Skeleton width="60%" height={14} radius={4} style={{ marginBottom: 8 }} />
                ) : details?.tagline ? (
                  <p className="modal-tagline">{details.tagline}</p>
                ) : null}
                <p className="modal-synopsis">{movie.synopsis}</p>
                {providersLoading ? (
                  <div className="watch-providers">
                    <div className="watch-providers-label">Available on</div>
                    <div className="watch-providers-row">
                      {Array.from({ length: 4 }, (_, i) => (
                        <div key={i} className="watch-provider-skeleton" />
                      ))}
                    </div>
                  </div>
                ) : providers.length > 0 && (
                  <div className="watch-providers">
                    <div className="watch-providers-label">Available on</div>
                    <div className="watch-providers-row">
                      {providers.map((p) => (
                        <img
                          key={p.provider_id}
                          className="watch-provider-logo"
                          src={`${IMG_BASE}/w92${p.logo_path}`}
                          alt={p.provider_name}
                          title={p.provider_name}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === "notes" && (
              <div className="journal-notes">
                <textarea
                  className="journal-notes-input"
                  placeholder="Write your thoughts about this film..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onBlur={saveNote}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Home Dashboard Cards ──────────────────────────────────────────────────────

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Animates a numeric value from 0 → target over `duration` ms with ease-out cubic.
// Returns `null` when target is null (so callers can render "—" without animation).
function useAnimatedCount(target, duration = 600, decimals = 0) {
  const [value, setValue] = useState(target == null ? null : 0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (target == null) { setValue(null); return; }
    const start = performance.now();
    const from = 0;
    const to = Number(target);
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setValue(current);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  if (value == null) return "—";
  return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
}

function ProgressRing({ value, goal, size = 64, stroke = 5 }) {
  const radius = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * radius;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const offset = circ * (1 - pct);
  return (
    <svg className="reel-ring-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={c} cy={c} r={radius}
        fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke}
      />
      <circle
        cx={c} cy={c} r={radius}
        fill="none" stroke="var(--accent-burgundy)" strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${c} ${c})`}
        style={{ transition: "stroke-dashoffset 800ms cubic-bezier(0.22, 0.61, 0.36, 1)" }}
      />
    </svg>
  );
}

const REEL_TIMEFRAMES = [
  { id: "week", label: "Week", goal: 5 },
  { id: "month", label: "Month", goal: 20 },
  { id: "all", label: "All Time", goal: null },
];

function computeReelStats(timeframe, watchedDates, watchedRatings, watchedMovies) {
  const now = DateTime.now();
  const watched = []; // [{id, dateStr, dt}]
  if (watchedDates) {
    watchedDates.forEach((dateStr, id) => {
      if (!dateStr) return;
      const dKey = dateStr.slice(0, 10);
      const dt = DateTime.fromISO(dKey);
      if (!dt.isValid) return;
      watched.push({ id, dateStr: dKey, dt });
    });
  }

  let cutoff = null;
  let buckets = [];
  let todayKey = now.toFormat("yyyy-MM-dd");

  if (timeframe === "week") {
    cutoff = now.minus({ days: 6 }).startOf("day");
    buckets = Array.from({ length: 7 }, (_, i) => {
      const d = cutoff.plus({ days: i });
      return {
        key: d.toFormat("yyyy-MM-dd"),
        label: DAY_LABELS[(d.weekday + 6) % 7],
        count: 0,
        match: (entry) => entry.dateStr === d.toFormat("yyyy-MM-dd"),
      };
    });
  } else if (timeframe === "month") {
    cutoff = now.minus({ days: 29 }).startOf("day");
    buckets = Array.from({ length: 4 }, (_, i) => {
      const start = cutoff.plus({ days: i * 7 });
      const end = i === 3 ? now.endOf("day") : cutoff.plus({ days: (i + 1) * 7 - 1 }).endOf("day");
      return {
        key: `wk${i}`,
        label: `W${i + 1}`,
        count: 0,
        match: (entry) => entry.dt >= start && entry.dt <= end,
      };
    });
  } else {
    // All time → 6-month buckets ending this month
    const start6 = now.minus({ months: 5 }).startOf("month");
    cutoff = null; // no filter on stats — but the bars only count last 6 months
    buckets = Array.from({ length: 6 }, (_, i) => {
      const d = start6.plus({ months: i });
      return {
        key: d.toFormat("yyyy-MM"),
        label: MONTH_LABELS[d.month - 1],
        count: 0,
        match: (entry) => entry.dt.toFormat("yyyy-MM") === d.toFormat("yyyy-MM"),
      };
    });
  }

  const filteredIds = [];
  watched.forEach((entry) => {
    const inWindow = cutoff ? entry.dt >= cutoff : true;
    if (inWindow) filteredIds.push(entry.id);
    buckets.forEach((b) => { if (b.match(entry)) b.count += 1; });
  });

  // Hours from runtime cache
  const runtimeCache = loadFromStorage("cc_runtimeCache", {});
  let totalMinutes = 0;
  let missing = false;
  filteredIds.forEach((id) => {
    const r = runtimeCache[id];
    if (typeof r === "number" && r > 0) totalMinutes += r;
    else missing = true;
  });
  const films = filteredIds.length;
  const hours = films === 0 ? null : missing ? null : totalMinutes / 60;

  // Avg rating
  const ratings = filteredIds.map((id) => watchedRatings?.get(id)).filter((r) => typeof r === "number");
  const avgRating = ratings.length > 0
    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length / 10)
    : null;

  const maxBar = Math.max(1, ...buckets.map((b) => b.count));
  return { films, hours, avgRating, buckets, maxBar, todayKey };
}

function computeBadges(watchedDates, watchedRatings, watchedMovies) {
  const totalWatched = watchedDates?.size || 0;
  const totalRated = watchedRatings ? Array.from(watchedRatings.values()).filter((r) => typeof r === "number").length : 0;

  // Build a Set of ISO date strings for streak + weekly checks
  const watchedDays = new Set();
  if (watchedDates) {
    watchedDates.forEach((dateStr) => {
      if (dateStr) watchedDays.add(dateStr.slice(0, 10));
    });
  }

  // Streak: count consecutive days backwards from today
  let streak = 0;
  let cursor = DateTime.now().startOf("day");
  while (watchedDays.has(cursor.toFormat("yyyy-MM-dd"))) {
    streak += 1;
    cursor = cursor.minus({ days: 1 });
  }

  // Consistent: at least 1 movie in each of the last 4 weeks
  const now = DateTime.now();
  let consistent = true;
  for (let w = 0; w < 4; w++) {
    const weekStart = now.minus({ days: (w + 1) * 7 - 1 }).startOf("day");
    const weekEnd = now.minus({ days: w * 7 }).endOf("day");
    const hit = Array.from(watchedDays).some((ds) => {
      const dt = DateTime.fromISO(ds);
      return dt.isValid && dt >= weekStart && dt <= weekEnd;
    });
    if (!hit) { consistent = false; break; }
  }
  if (totalWatched < 4) consistent = false;

  // Top genre
  const genreCounts = {};
  watchedMovies?.forEach((m) => {
    const g = m?.genre;
    if (!g || g === "Film") return;
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  });
  let topGenre = null, topCount = 0;
  Object.entries(genreCounts).forEach(([g, c]) => { if (c > topCount) { topGenre = g; topCount = c; } });

  const badges = [];
  if (streak >= 2) badges.push({ id: "streak", icon: "🔥", label: `${streak}-day streak` });
  if (totalWatched >= 100) badges.push({ id: "century", icon: "🏆", label: "Century club" });
  else if (totalWatched >= 10) badges.push({ id: "power", icon: "🎬", label: "Power viewer" });
  if (totalRated >= 20) badges.push({ id: "critic", icon: "⭐", label: "Critic" });
  if (consistent) badges.push({ id: "consistent", icon: "🎯", label: "Consistent" });
  if (topGenre && topCount >= 3) badges.push({ id: "genre", icon: "❤️", label: `${topGenre} fan` });

  return badges;
}

function YourReelCard({ watchedDates, watchedRatings, watchedMovies }) {
  const [timeframe, setTimeframe] = useState("week");

  const stats = useMemo(
    () => computeReelStats(timeframe, watchedDates, watchedRatings, watchedMovies),
    [timeframe, watchedDates, watchedRatings, watchedMovies]
  );

  const badges = useMemo(
    () => computeBadges(watchedDates, watchedRatings, watchedMovies),
    [watchedDates, watchedRatings, watchedMovies]
  );

  const filmsDisplay = useAnimatedCount(stats.films, 600, 0);

  const tfMeta = REEL_TIMEFRAMES.find((t) => t.id === timeframe);
  const showRing = tfMeta?.goal != null;

  const cycleTimeframe = () => {
    const idx = REEL_TIMEFRAMES.findIndex((t) => t.id === timeframe);
    setTimeframe(REEL_TIMEFRAMES[(idx + 1) % REEL_TIMEFRAMES.length].id);
  };

  return (
    <div className="dash-card reel-card">
      <div className="reel-card-header">
        <div className="dash-card-label">YOUR REEL</div>
        <button
          type="button"
          className="reel-tf-cycle"
          onClick={cycleTimeframe}
          aria-label={`Timeframe: ${tfMeta?.label || ""} (click to change)`}
        >
          {(tfMeta?.label || "").toUpperCase()} <span className="reel-tf-caret" aria-hidden="true">▾</span>
        </button>
      </div>

      <div className="reel-focal">
        <span className="reel-focal-num">{filmsDisplay}</span>
        {showRing && (
          <span className="reel-focal-goal"> / {tfMeta.goal}</span>
        )}
      </div>
      <div className="reel-focal-label">{showRing ? "FILMS TOWARD GOAL" : "FILMS WATCHED"}</div>

      <div className="reel-bars">
        {stats.buckets.map((b) => {
          const isFilled = b.count > 0;
          return (
            <div
              key={b.key}
              className={`reel-bar-block${isFilled ? " filled" : ""}`}
              aria-label={`${b.label}: ${b.count} film${b.count === 1 ? "" : "s"}`}
            />
          );
        })}
      </div>
      <div className="reel-bar-labels">
        {stats.buckets.map((b) => (
          <div key={b.key} className="reel-bar-label">
            {timeframe === "week" ? b.label.charAt(0) : b.label}
          </div>
        ))}
      </div>

      {stats.films === 0 && (
        <div className="reel-empty-msg">Watch a movie to start tracking</div>
      )}
    </div>
  );
}

const CINNO_GREETINGS = [
  "You've been on a heavy streak. Want to break it with something lighter?",
  "Noticed you love sci-fi lately. Want to go deeper?",
  "Haven't watched anything in a while. Need a recommendation?",
  "Your taste has been eclectic this week. Keep exploring?",
  "You rated your last watch pretty high. Want something similar?",
];

const CINNO_SUGGESTIONS = [
  "Recommend something",
  "Surprise me",
  "What should I watch tonight?",
];

// Module-level cache for the day's candidate pool — survives Home tab unmount/remount.
const _cinnoPickPool = { movies: [], userId: null };

const CINNO_PICK_REASON_PROMPT = "You are Cinno, a witty film companion. Given a movie title and its overview, write a single compelling sentence (under 15 words) explaining why someone should watch it. Be specific to the movie, not generic. No quotes, no preamble.";

function firstSentence(text) {
  if (!text) return null;
  const m = text.match(/[^.!?]+[.!?]/);
  return (m ? m[0] : text).trim();
}

function CinnoPickCard({ user, isGuest, getAccessToken, watchedIds, savedIds, savedMovies, listsLoading, toggleSave, setSelectedMovie }) {
  // PRIMARY pool: user's watchlist (shared across Home + Watchlist via cc_tonightPickId).
  const savedPool = useMemo(() => {
    if (!savedMovies || savedMovies.size === 0) return [];
    return Array.from(savedMovies.values()).filter((m) => m && (m.backdrop_path || m.poster_path));
  }, [savedMovies]);

  // FALLBACK pool: TMDB popular (only after savedMovies is *confirmed* empty).
  const [tmdbPool, setTmdbPool] = useState(() =>
    _cinnoPickPool.userId === (user?.id || null) ? _cinnoPickPool.movies : []
  );
  const useSavedPool = savedPool.length > 0;
  // Only treat the watchlist as "empty" once the lists fetch has settled. While
  // listsLoading is true, we hold the slot instead of falling back to TMDB —
  // otherwise Home would write a TMDB id into cc_tonightPickId before the user's
  // saved films have a chance to load, diverging from the Watchlist tab.
  const savedConfirmedEmpty = !listsLoading && savedPool.length === 0;
  const pool = useSavedPool ? savedPool : (savedConfirmedEmpty ? tmdbPool : []);

  // Shared pick id, persisted in localStorage so Home <-> Watchlist stay in sync.
  const [pickId, setPickId] = useState(() => loadFromStorage("cc_tonightPickId", null));
  const [reason, setReason] = useState(null);
  const [reasonLoading, setReasonLoading] = useState(false);
  const [fading, setFading] = useState(false);

  const movie = useMemo(() => {
    if (pool.length === 0) return null;
    if (pickId) {
      const found = pool.find((m) => m.id === pickId);
      if (found) return found;
    }
    return pool[0];
  }, [pool, pickId]);

  // Validate stored pickId against the active pool; if missing/stale, pick a fresh
  // random AND persist it. Skipped entirely while we're still waiting on
  // savedMovies to load (would otherwise stamp a TMDB id over a valid watchlist id).
  useEffect(() => {
    if (pool.length === 0) return;
    if (!useSavedPool && !savedConfirmedEmpty) return;
    const stored = loadFromStorage("cc_tonightPickId", null);
    if (stored && pool.some((m) => m.id === stored)) {
      if (stored !== pickId) setPickId(stored);
      return;
    }
    const rand = pool[Math.floor(Math.random() * pool.length)];
    setPickId(rand.id);
    saveToStorage("cc_tonightPickId", rand.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, useSavedPool, savedConfirmedEmpty]);

  // Fetch TMDB fallback pool ONLY once savedMovies is confirmed empty
  // (i.e., the lists fetch finished and there are no saved films).
  useEffect(() => {
    if (useSavedPool) return;
    if (!savedConfirmedEmpty) return;
    if (_cinnoPickPool.userId === (user?.id || null) && _cinnoPickPool.movies.length > 0) return;
    let cancelled = false;
    const randomPage = 1 + Math.floor(Math.random() * 10);
    getPopular(randomPage)
      .then((r) => {
        if (cancelled) return;
        const filtered = (r?.movies || [])
          .filter((m) => m.backdrop_path)
          .filter((m) => !watchedIds?.has(m.id))
          .filter((m) => !savedIds?.has(m.id));
        _cinnoPickPool.userId = user?.id || null;
        _cinnoPickPool.movies = filtered;
        setTmdbPool(filtered);
      })
      .catch((err) => {
        console.error("[CinnoPick] getPopular failed:", err?.message || err);
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, useSavedPool, savedConfirmedEmpty]);

  // AI reason — cached per (date + movie) in localStorage; falls back to overview.
  useEffect(() => {
    if (!movie) { setReason(null); return; }
    const today = DateTime.now().toFormat("yyyy-MM-dd");
    const cacheKey = `cc_cinno_pick_${today}_${movie.id}`;
    const cached = loadFromStorage(cacheKey, null);
    if (cached?.reason) { setReason(cached.reason); setReasonLoading(false); return; }

    // Guests / unauthenticated → use the synopsis as the reason (no AI call)
    if (isGuest || !user) {
      setReason(firstSentence(movie.synopsis));
      setReasonLoading(false);
      return;
    }

    let cancelled = false;
    setReasonLoading(true);
    setReason(null);
    (async () => {
      try {
        const token = getAccessToken();
        if (!token) throw new Error("no token");
        const userMsg = `Title: ${movie.title}\nOverview: ${movie.synopsis || "(no overview)"}`;
        const resp = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 60,
            system: CINNO_PICK_REASON_PROMPT,
            messages: [{ role: "user", content: userMsg }],
          }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || "API error");
        const text = data.content?.[0]?.text?.trim();
        if (cancelled) return;
        if (!text) throw new Error("empty");
        setReason(text);
        saveToStorage(cacheKey, { reason: text, ts: Date.now() });
      } catch (err) {
        console.error("[CinnoPick] AI reason failed:", err?.message || err);
        if (!cancelled) setReason(firstSentence(movie.synopsis));
      } finally {
        if (!cancelled) setReasonLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movie?.id, isGuest, user?.id]);

  const shuffle = () => {
    if (pool.length < 2 || fading) return;
    setFading(true);
    setTimeout(() => {
      // Prefer the saved pool when available — mirrors the Watchlist shuffle
      // (anti-self filter + random pick + persist). Falls back to the TMDB
      // pool only when the user has no saved films.
      if (useSavedPool) {
        const others = savedPool.filter((m) => m.id !== (movie?.id));
        if (others.length === 0) { setFading(false); return; }
        const pick = others[Math.floor(Math.random() * others.length)];
        setPickId(pick.id);
        saveToStorage("cc_tonightPickId", pick.id);
      } else {
        let next = movie;
        let attempts = 0;
        while (next?.id === movie?.id && tmdbPool.length > 1 && attempts < 20) {
          next = tmdbPool[Math.floor(Math.random() * tmdbPool.length)];
          attempts += 1;
        }
        if (next?.id) {
          setPickId(next.id);
          saveToStorage("cc_tonightPickId", next.id);
        }
      }
      setFading(false);
    }, 180);
  };

  // Loading state — we have a logged-in user whose saved films haven't loaded yet.
  // Hold the card slot (don't fall back to TMDB) so the Home pick can match Watchlist
  // once Supabase responds.
  if (!movie && !useSavedPool && !savedConfirmedEmpty) {
    return <div className="dash-card tonight-pick-card" aria-hidden="true" />;
  }

  if (!movie) return null;

  const posterUrl = movie.backdrop_path
    ? `${IMG_BASE}/w1280${movie.backdrop_path}`
    : (movie.poster_path ? `${IMG_BASE}/w500${movie.poster_path}` : null);
  const isSaved = savedIds?.has(movie.id);

  return (
    <div className="dash-card tonight-pick-card">
      <div className={`tonight-pick-inner${fading ? " tonight-pick-fading" : ""}`}>
        <div className="tonight-pick-slab">
          <div className="tonight-pick-slab-glow" aria-hidden="true" />
          {posterUrl && <img src={posterUrl} alt="" className="tonight-pick-slab-poster" />}
          <div className="tonight-pick-slab-title">{movie.title}</div>
        </div>
        <div className="tonight-pick-content">
          <div className="tonight-pick-top">
            <div className="tonight-pick-label">◉ TONIGHT&apos;S PICK · FROM WATCHLIST</div>
            <div className="tonight-pick-title">{movie.title}</div>
            {reasonLoading ? (
              <div className="tonight-pick-reason-skel skel" />
            ) : reason ? (
              <div className="tonight-pick-reason">{reason}</div>
            ) : null}
          </div>
          <div className="tonight-pick-actions">
            <button
              className="tonight-pick-btn"
              onClick={() => setSelectedMovie(movie)}
              title="More info"
            >
              <span>More info</span>
            </button>
            <button
              className="tonight-pick-btn"
              onClick={shuffle}
              disabled={pool.length < 2}
              title="Shuffle"
            >
              <ShuffleIcon size={13} />
              <span>↻ Shuffle</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CinnoCompanionCard({ goToCompanion, startCinnoChat }) {
  // Stable greeting per session — picked once on mount.
  const [greeting] = useState(() => CINNO_GREETINGS[Math.floor(Math.random() * CINNO_GREETINGS.length)]);

  return (
    <div className="dash-card cinno-card">
      <div className="cinno-card-header">
        <div className="cinno-card-brand">
          <span className="cinno-card-avatar" aria-hidden="true">C</span>
          <span className="cinno-card-name">Cinno</span>
        </div>
        <div className="cinno-card-status">
          <span className="cinno-status-dot" />
          <span>ONLINE</span>
        </div>
      </div>
      <div className="cinno-card-bubble">{greeting}</div>
      <div className="cinno-card-pills">
        {CINNO_SUGGESTIONS.map((s) => (
          <button key={s} className="cinno-pill" onClick={() => startCinnoChat(s)}>{s}</button>
        ))}
      </div>
      <button className="cinno-mini-input" onClick={goToCompanion}>
        <span>Ask Cinno anything…</span>
        <span className="cinno-mini-send" aria-hidden="true">➤</span>
      </button>
    </div>
  );
}

// ─── From-Your-Journal recent watches strip ────────────────────────────────────

function StarRating({ score }) {
  // score is 0-100; render 5 stars with proportional fill width.
  const pct = Math.max(0, Math.min(100, score || 0));
  return (
    <div className="star-rating" aria-label={`${(score / 20).toFixed(1)} stars`}>
      <span className="star-rating-bg">★★★★★</span>
      <span className="star-rating-fg" style={{ width: `${pct}%` }}>★★★★★</span>
    </div>
  );
}

function JournalRecentSection({ watchedMovies, watchedDates, watchedRatings, watchedNotes, onCardClick, goToJournal }) {
  const recent = useMemo(() => {
    if (!watchedMovies || !watchedDates) return [];
    const list = [];
    watchedDates.forEach((dateStr, id) => {
      const movie = watchedMovies.get(id);
      if (!movie) return;
      list.push({ ...movie, _watchedAt: dateStr });
    });
    list.sort((a, b) => (b._watchedAt || "").localeCompare(a._watchedAt || ""));
    return list.slice(0, 3);
  }, [watchedMovies, watchedDates]);

  if (recent.length === 0) return null;

  return (
    <div className="browse-section journal-recent-section">
      <div className="browse-section-header browse-section-header-v2">
        <div className="browse-section-titles">
          <div className="browse-section-eyebrow">— DIARY · LAST 7 DAYS —</div>
          <div className="browse-section-title">From your journal</div>
        </div>
        <div className="browse-section-actions">
          <button className="browse-section-browse-all" onClick={goToJournal}>View all ›</button>
        </div>
      </div>
      <div className="journal-recent-row">
        {recent.map((movie) => {
          const rating = watchedRatings?.get(movie.id);
          const note = watchedNotes?.get(movie.id);
          const dateStr = movie._watchedAt ? movie._watchedAt.slice(0, 10) : null;
          let dateLabel = "";
          if (dateStr) {
            const dt = DateTime.fromISO(dateStr);
            if (dt.isValid) dateLabel = `${dt.toFormat("MMM d")} · ${movie.year || dt.year}`;
          }
          const truncatedNote = note && note.length > 100 ? note.slice(0, 100).trim() + "…" : note;
          return (
            <button
              key={movie.id}
              className="journal-recent-card"
              onClick={() => onCardClick(movie)}
            >
              <div className="journal-recent-poster">
                <PosterImage posterPath={movie.poster_path} title={movie.title} />
              </div>
              <div className="journal-recent-info">
                <div className="journal-recent-title">{movie.title}</div>
                {dateLabel && <div className="journal-recent-date">{dateLabel}</div>}
                {typeof rating === "number" && <StarRating score={rating} />}
                {truncatedNote && <div className="journal-recent-note">{truncatedNote}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Your Taste editorial section ─────────────────────────────────────────────

const TASTE_SYSTEM_PROMPT = "You are Cinno, a witty, concise film companion. Generate ONE sentence — an editorial summary of the user's monthly viewing taste. Be playful, opinionated, and specific. Use bold (**word**) and italic (*word*) markdown for emphasis on 2-3 key words. Example: 'You leaned **heavy & cerebral** this month.' Keep it under 20 words. Output ONLY the sentence — no preamble, no quotes.";

function parseInlineMarkdown(text) {
  // Tokenize **bold** and *italic*. Returns an array of React nodes.
  // The first emphasized phrase (bold or italic) gets className="taste-accent".
  const nodes = [];
  let remaining = text;
  let key = 0;
  let firstAccentUsed = false;
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/;
  while (remaining.length > 0) {
    const m = remaining.match(re);
    if (!m) { nodes.push(remaining); break; }
    if (m.index > 0) nodes.push(remaining.slice(0, m.index));
    const accentClass = !firstAccentUsed ? "taste-accent" : undefined;
    if (m[2]) {
      nodes.push(<strong key={key++} className={accentClass}>{m[2]}</strong>);
      firstAccentUsed = true;
    } else if (m[3]) {
      nodes.push(<em key={key++} className={accentClass}>{m[3]}</em>);
      firstAccentUsed = true;
    }
    remaining = remaining.slice(m.index + m[0].length);
  }
  return nodes;
}

const TASTE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function YourTasteSection({ user, getAccessToken, watchedMovies, watchedDates, watchedRatings, goToJournal }) {
  const monthStats = useMemo(() => {
    const now = DateTime.now();
    const thirtyDaysAgo = now.minus({ days: 30 }).startOf("day");
    const ids = [];
    if (watchedDates) {
      watchedDates.forEach((dateStr, id) => {
        const d = DateTime.fromISO((dateStr || "").slice(0, 10));
        if (d.isValid && d >= thirtyDaysAgo) ids.push(id);
      });
    }
    const movies = ids.map((id) => watchedMovies?.get(id)).filter(Boolean);
    const ratings = ids.map((id) => watchedRatings?.get(id)).filter((r) => typeof r === "number");
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

    const genreCounts = {};
    movies.forEach((m) => { if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1; });
    let topGenre = null, topCount = 0;
    Object.entries(genreCounts).forEach(([g, c]) => { if (c > topCount) { topGenre = g; topCount = c; } });
    const topPct = movies.length > 0 ? Math.round((topCount / movies.length) * 100) : 0;

    const runtimeCache = loadFromStorage("cc_runtimeCache", {});
    let totalMinutes = 0;
    let runtimeMissing = false;
    ids.forEach((id) => {
      const r = runtimeCache[id];
      if (typeof r === "number" && r > 0) totalMinutes += r;
      else runtimeMissing = true;
    });
    const hours = runtimeMissing && ids.length > 0 ? null : totalMinutes / 60;

    let highest = null, lowest = null;
    movies.forEach((m) => {
      const r = watchedRatings?.get(m.id);
      if (typeof r !== "number") return;
      if (!highest || r > highest.r) highest = { m, r };
      if (!lowest || r < lowest.r) lowest = { m, r };
    });

    return {
      monthLabel: "LAST 30 DAYS",
      films: movies.length,
      hours,
      avgRating,
      topGenre,
      topPct,
      highest,
      lowest,
      titles: movies.map((m) => m.title).slice(0, 12),
    };
  }, [watchedMovies, watchedDates, watchedRatings]);

  const cacheKey = `cc_taste_summary_30d_${user?.id || "anon"}`;

  const [summary, setSummary] = useState(() => {
    const cached = loadFromStorage(cacheKey, null);
    if (!cached?.text || !cached?.generatedAt) return null;
    if (Date.now() - cached.generatedAt > TASTE_CACHE_TTL_MS) return null;
    return cached.text;
  });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (monthStats.films === 0) return;
    if (summary) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchSummary = async () => {
      setLoading(true);
      setFailed(false);
      try {
        const token = getAccessToken();
        if (!token) throw new Error("no token");
        const titlesLine = monthStats.titles.length > 0 ? `Titles watched: ${monthStats.titles.join(", ")}.` : "";
        const ratingLine = monthStats.avgRating ? ` Average rating ${(monthStats.avgRating).toFixed(0)}/100.` : "";
        const genreLine = monthStats.topGenre ? ` Top genre: ${monthStats.topGenre} (${monthStats.topPct}% of watches).` : "";
        const hiLine = monthStats.highest ? ` Highest-rated: ${monthStats.highest.m.title} (${monthStats.highest.r}/100).` : "";
        const loLine = monthStats.lowest && monthStats.lowest.m.id !== monthStats.highest?.m?.id
          ? ` Lowest-rated: ${monthStats.lowest.m.title} (${monthStats.lowest.r}/100).` : "";
        const userMsg = `${monthStats.films} films in the last 30 days.${ratingLine}${genreLine}${hiLine}${loLine} ${titlesLine}`.trim();
        const resp = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 80,
            system: TASTE_SYSTEM_PROMPT,
            messages: [{ role: "user", content: userMsg }],
          }),
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || "API error");
        const text = data.content?.[0]?.text?.trim();
        if (!text) throw new Error("empty");
        setSummary(text);
        saveToStorage(cacheKey, { text, generatedAt: Date.now() });
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, [user, monthStats.films, summary, cacheKey, getAccessToken, monthStats]);

  if (!user) return null;
  if (monthStats.films === 0) return null;
  if (failed && !summary) return null;

  return (
    <div className="taste-section">
      <div className="taste-eyebrow">
        <span className="taste-eyebrow-bar" aria-hidden="true" />
        <span>YOUR TASTE · {monthStats.monthLabel}</span>
      </div>
      {loading && !summary ? (
        <>
          <div className="taste-summary-skeleton skel" />
          <div className="taste-summary-skeleton skel taste-summary-skeleton-short" />
        </>
      ) : (
        <h2 className="taste-summary">{parseInlineMarkdown(summary || "")}</h2>
      )}

      <div className="taste-meta-strip">
        <div className="taste-meta-stat">
          <div className="taste-meta-num">{monthStats.films}</div>
          <div className="taste-meta-label">Films Watched</div>
        </div>
        {monthStats.topGenre && (
          <div className="taste-meta-stat">
            <div className="taste-meta-num taste-meta-num-up">↑{monthStats.topPct}%</div>
            <div className="taste-meta-label">{monthStats.topGenre} This Month</div>
          </div>
        )}
        {monthStats.avgRating !== null && (
          <div className="taste-meta-stat">
            <div className="taste-meta-num">{(monthStats.avgRating / 10).toFixed(1)}</div>
            <div className="taste-meta-label">Average Rating</div>
          </div>
        )}
      </div>

      <div className="taste-actions">
        <button className="taste-btn taste-btn-primary" onClick={goToJournal}>Open journal</button>
        <button className="taste-btn taste-btn-disabled" disabled title="Coming soon">Year in review →</button>
      </div>
    </div>
  );
}

// Module-level cache so personalized rails survive Home tab unmount/remount.
// Keyed by user.id so the cache is invalidated on user switch.
const _personalizedRailsCache = {
  userId: null,
  picksRefId: null,
  picksMovies: [],
  picksRefMovie: null,
  popularWatchedKey: null,
  popularMovies: [],
};

// ─── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({ savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, collections, toggleMovieInCollection, scrollPositions, watchedRatings, setWatchedRating, query, setQuery, watchedMovies, watchedDates, watchedNotes, setWatchedNote, savedMovies, listsLoading, goToCompanion, startCinnoChat, goToJournal }) {
  const [searchResults, setSearchResults] = useState([]);
  const [searchRetry, setSearchRetry] = useState(0);
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const genreFloating = useFloating({
    open: genreDropdownOpen,
    placement: "bottom-start",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const [trendingMovies, setTrendingMovies] = useState([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState(false);
  const [selectedMovie, setSelectedMovie] = useMovieModal();
  const [journalSelected, setJournalSelected] = useMovieModal();
  const { user, getAccessToken, isGuest } = useAuth();

  // Personalized rails: derived sync from journal data so the section is visible
  // on first paint (skeleton renders before fetch completes — avoids the blank-flash).
  const recentMovie = useMemo(() => {
    if (!watchedDates || watchedDates.size === 0) return null;
    let mostRecentId = null;
    let mostRecentDate = "";
    watchedDates.forEach((dateStr, id) => {
      const ds = (dateStr || "").slice(0, 10);
      if (ds > mostRecentDate) { mostRecentDate = ds; mostRecentId = id; }
    });
    return mostRecentId ? watchedMovies?.get(mostRecentId) : null;
  }, [watchedDates, watchedMovies]);

  // Cache key for "Popular you haven't seen" — invalidates when the watched count changes
  // (treating "you watched something new" as the trigger to refresh). Guests get a stable key 0.
  const watchedKey = user ? (watchedIds?.size ?? 0) : 0;

  // Drives the side-by-side dashboard layout: editorial column shows only when the
  // YourTasteSection has data to display (logged-in user with ≥1 watch in last 30 days).
  const hasEditorial = useMemo(() => {
    if (!user || !watchedDates) return false;
    const cutoff = DateTime.now().minus({ days: 30 }).startOf("day");
    for (const dateStr of watchedDates.values()) {
      const d = DateTime.fromISO((dateStr || "").slice(0, 10));
      if (d.isValid && d >= cutoff) return true;
    }
    return false;
  }, [user, watchedDates]);

  const homeStats = useMemo(() => {
    if (!user || !watchedDates || !watchedMovies) return null;
    const now = DateTime.now();
    const cutoff = now.minus({ days: 30 }).startOf("day");
    const ids = [];
    watchedDates.forEach((dateStr, id) => {
      const d = DateTime.fromISO((dateStr || "").slice(0, 10));
      if (d.isValid && d >= cutoff) ids.push(id);
    });
    if (ids.length === 0) return null;
    const movies = ids.map((id) => watchedMovies?.get(id)).filter(Boolean);
    const ratings = ids.map((id) => watchedRatings?.get(id)).filter((r) => typeof r === "number");
    const avgRating = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length / 10).toFixed(1) : null;
    const genreCounts = {};
    movies.forEach((m) => { if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1; });
    let topGenre = null, topCount = 0;
    Object.entries(genreCounts).forEach(([g, c]) => { if (c > topCount) { topGenre = g; topCount = c; } });
    const topPct = movies.length > 0 ? Math.round((topCount / movies.length) * 100) : 0;
    return { films: ids.length, topGenre, topPct, avgRating };
  }, [user, watchedDates, watchedMovies, watchedRatings]);

  // Hydrate from module cache when the keys still match (e.g. tab switch back to Home).
  // Otherwise initialize empty + loading=true so the skeleton shows immediately.
  const cacheUserMatches = _personalizedRailsCache.userId === (user?.id || null);
  const picksCacheHit = cacheUserMatches && recentMovie && _personalizedRailsCache.picksRefId === recentMovie.id;
  const popularCacheHit = cacheUserMatches && _personalizedRailsCache.popularWatchedKey === watchedKey && _personalizedRailsCache.popularMovies.length > 0;

  const [pickedMovies, setPickedMovies] = useState(() => picksCacheHit ? _personalizedRailsCache.picksMovies : []);
  const [pickedLoading, setPickedLoading] = useState(() => Boolean(recentMovie) && !picksCacheHit);
  const [popularMovies, setPopularMovies] = useState(() => popularCacheHit ? _personalizedRailsCache.popularMovies : []);
  const [popularLoading, setPopularLoading] = useState(() => !popularCacheHit);
  const [popularFailed, setPopularFailed] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const searchTimeout = useRef(null);
  const genreDropdownRef = useRef(null);
  const touchStartY = useRef(0);
  const contentRef = useRef(null);
  const pulling = useRef(false);
  useScrollRestore("search", scrollPositions, contentRef);
  const [heroIndex, setHeroIndex] = useState(0);
  const [heroMovies, setHeroMovies] = useState([]);

  const toggleGenre = (id) => {
    setSelectedGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const fetchBrowse = useCallback(async (genres, pg = 1) => {
    if (pg === 1) { setMoviesLoading(true); setFetchError(false); }
    else setLoadingMore(true);
    try {
      const result = await discoverByGenres(genres, pg);
      if (pg === 1) setMovies(result.movies || []);
      else setMovies((prev) => [...prev, ...(result.movies || [])]);
      setPage(pg);
      setTotalPages(result.totalPages || 1);
    } catch {
      if (pg === 1) setFetchError(true);
    } finally {
      setMoviesLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadMoreSearch = async () => {
    const nextPage = searchPage + 1;
    setLoadingMore(true);
    try {
      const result = await searchMovies(query, nextPage);
      setSearchResults((prev) => [...prev, ...result.movies]);
      setSearchPage(nextPage);
      setSearchTotalPages(result.totalPages || 1);
    } catch {
      // silently fail for load-more, user can tap again
    } finally {
      setLoadingMore(false);
    }
  };

  const fetchAllSections = useCallback(() => {
    setTrendingLoading(true); setTrendingError(false);
    const p1 = getTrending(1)
      .then((r) => {
        const list = (r?.movies || []).slice(0, 20);
        setTrendingMovies(list);
        setTrendingLoading(false);
      })
      .catch((err) => {
        console.error("[Home] getTrending failed:", err?.message || err);
        setTrendingLoading(false);
        setTrendingError(true);
      });

    return Promise.all([p1]);
  }, []);

  // Fetch trending on mount
  useEffect(() => { fetchAllSections(); }, [fetchAllSections]);

  // Personalized "Because you watched" rail: refetch only when the reference movie changes.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // Reset cache if user switched
    if (_personalizedRailsCache.userId !== user.id) {
      _personalizedRailsCache.userId = user.id;
      _personalizedRailsCache.picksRefId = null;
      _personalizedRailsCache.picksMovies = [];
      _personalizedRailsCache.picksRefMovie = null;
      _personalizedRailsCache.popularWatchedKey = null;
      _personalizedRailsCache.popularMovies = [];
    }

    if (recentMovie && _personalizedRailsCache.picksRefId !== recentMovie.id) {
      setPickedLoading(true);
      getSimilar(recentMovie.id, 30)
        .then((list) => {
          if (cancelled) return;
          const filtered = (list || []).filter((m) => !watchedIds?.has(m.id)).slice(0, 20);
          _personalizedRailsCache.picksRefId = recentMovie.id;
          _personalizedRailsCache.picksRefMovie = recentMovie;
          _personalizedRailsCache.picksMovies = filtered;
          setPickedMovies(filtered);
        })
        .catch((err) => {
          console.error("[Home] getSimilar failed:", err?.message || err);
          if (!cancelled) setPickedMovies([]);
        })
        .finally(() => { if (!cancelled) setPickedLoading(false); });
    } else if (!recentMovie) {
      setPickedMovies([]);
      setPickedLoading(false);
    }

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, recentMovie]);

  // "You haven't seen these yet" / "Popular right now": refetch on first mount or when
  // the user's watched-count changes. Guests use a stable key so we only fetch once.
  useEffect(() => {
    let cancelled = false;
    if (_personalizedRailsCache.popularWatchedKey === watchedKey && _personalizedRailsCache.popularMovies.length > 0) {
      // Cache hit — already hydrated via initializer. Nothing to do.
      return;
    }
    setPopularLoading(true);
    setPopularFailed(false);
    const randomPage = 1 + Math.floor(Math.random() * 5);
    getPopular(randomPage)
      .then((r) => {
        if (cancelled) return;
        const list = r?.movies || [];
        _personalizedRailsCache.popularWatchedKey = watchedKey;
        _personalizedRailsCache.popularMovies = list;
        setPopularMovies(list);
      })
      .catch((err) => {
        console.error("[Home] getPopular failed:", err?.message || err);
        if (!cancelled) {
          setPopularMovies([]);
          setPopularFailed(true);
        }
      })
      .finally(() => { if (!cancelled) setPopularLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedKey]);

  // Filter popular movies against watched + trending at render time (trending may load later).
  const popularFiltered = useMemo(() => {
    if (popularMovies.length === 0) return [];
    const trendingIds = new Set(trendingMovies.map((m) => m.id));
    return popularMovies
      .filter((m) => !trendingIds.has(m.id))
      .filter((m) => !user || !watchedIds?.has(m.id))
      .slice(0, 20);
  }, [popularMovies, trendingMovies, watchedIds, user]);

  // Shuffle trending movies for hero banner on load
  useEffect(() => {
    if (trendingMovies.length === 0) return;
    const shuffled = [...trendingMovies];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setHeroMovies(shuffled);
    setHeroIndex(0);
    setTimeout(() => AOS.refresh(), 50);
  }, [trendingMovies]);

  // Auto-rotate hero banner every 8 seconds
  useEffect(() => {
    if (heroMovies.length === 0) return;
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroMovies.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [heroMovies]);

  // Re-fetch genre browse when genre selection changes
  useEffect(() => {
    if (selectedGenres.length > 0) fetchBrowse(selectedGenres, 1);
  }, [selectedGenres, fetchBrowse]);

  // Close genre dropdown on outside click
  useEffect(() => {
    if (!genreDropdownOpen) return;
    const handler = (e) => {
      if (genreDropdownRef.current && !genreDropdownRef.current.contains(e.target))
        setGenreDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [genreDropdownOpen]);

  // Debounced search whenever the (externally-controlled) query changes.
  useEffect(() => {
    setSearchPage(1);
    setFetchError(false);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setSearchResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const result = await searchMovies(query, 1);
        setSearchResults(result.movies);
        setSearchTotalPages(result.totalPages || 1);
        setTimeout(() => AOS.refresh(), 50);
      } catch {
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(searchTimeout.current);
  }, [query, searchRetry]);

  const isSearching = query.trim().length > 0;
  const isGenreFiltered = selectedGenres.length > 0;
  const displayMovies = isSearching ? searchResults : movies;
  const canLoadMore = isSearching ? searchPage < searchTotalPages : page < totalPages;
  const browseLabel = isGenreFiltered
    ? GENRE_FILTERS.filter((g) => selectedGenres.includes(g.id)).map((g) => g.label).join(", ")
    : "";
  const showSections = !isSearching && !isGenreFiltered;

  const pullThreshold = 60;

  const onTouchStart = (e) => {
    if (contentRef.current && contentRef.current.scrollTop === 0 && !isSearching) {
      touchStartY.current = e.touches[0].clientY;
      pulling.current = true;
    }
  };

  const onTouchMove = (e) => {
    if (!pulling.current) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.4, pullThreshold * 1.5));
    } else {
      pulling.current = false;
      setPullDistance(0);
    }
  };

  const onTouchEnd = async () => {
    if (!pulling.current) return;
    pulling.current = false;
    if (pullDistance >= pullThreshold && !refreshing) {
      setRefreshing(true);
      setPullDistance(pullThreshold * 0.6);
      await fetchAllSections();
      setRefreshing(false);
      setPullDistance(0);
    } else {
      setPullDistance(0);
    }
  };

  const handleDesktopRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await fetchAllSections();
    setRefreshing(false);
  };

  return (
    <>
      <div
        className="content"
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {pullDistance > 0 && (
          <div className="pull-indicator" style={{ height: pullDistance }}>
            <div className={`pull-spinner ${refreshing ? "spinning" : ""}`} style={{ opacity: Math.min(pullDistance / pullThreshold, 1) }}>
              {refreshing ? (
                <div className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" style={{ transform: `rotate(${Math.min(pullDistance / pullThreshold, 1) * 180}deg)`, transition: "transform 0.1s" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </div>
          </div>
        )}
        {/* ── Search results ── */}
        {isSearching && (
          <>
            {!loading && (
              <div className="results-label" data-aos="fade-right" data-aos-duration="300">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{query}"
              </div>
            )}
            {fetchError && !loading ? (
              <div className="error-card">
                <div className="error-card-icon">📡</div>
                <div className="error-card-title">Couldn't load movies</div>
                <div className="error-card-desc">Something went wrong. Tap below to try again.</div>
                <button className="error-card-btn" onClick={() => setSearchRetry((n) => n + 1)}>Retry</button>
              </div>
            ) : loading && searchResults.length === 0 ? (
              <SkeletonGrid />
            ) : searchResults.length === 0 && !loading ? (
              <div className="no-results">
                <div className="no-results-icon">🎬</div>
                <p>No movies found for "{query}"</p>
              </div>
            ) : (
              <>
                <div className="movies-grid">
                  {searchResults.map((movie, i) => (
                    <MovieTile
                      key={movie.id}
                      movie={{ ...movie, _idx: i % 20 }}
                      isSaved={savedIds.has(movie.id)}
                      onToggleSave={toggleSave}
                      onClick={() => setSelectedMovie(movie)}
                    />
                  ))}
                </div>
                {searchPage < searchTotalPages && !loading && (
                  <div className="load-more-container">
                    <button className="load-more-btn" onClick={loadMoreSearch} disabled={loadingMore}>
                      {loadingMore
                        ? <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                        : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Genre-filtered grid ── */}
        {isGenreFiltered && !isSearching && (
          <>
            <div className="section-label" data-aos="fade-right" data-aos-duration="300">{browseLabel}</div>
            {fetchError && !moviesLoading ? (
              <div className="error-card">
                <div className="error-card-icon">📡</div>
                <div className="error-card-title">Couldn't load movies</div>
                <div className="error-card-desc">Something went wrong. Tap below to try again.</div>
                <button className="error-card-btn" onClick={() => fetchBrowse(selectedGenres, 1)}>Retry</button>
              </div>
            ) : moviesLoading && movies.length === 0 ? (
              <SkeletonGrid />
            ) : (
              <>
                <div className="movies-grid">
                  {movies.map((movie, i) => (
                    <MovieTile
                      key={movie.id}
                      movie={{ ...movie, _idx: i % 20 }}
                      isSaved={savedIds.has(movie.id)}
                      onToggleSave={toggleSave}
                      onClick={() => setSelectedMovie(movie)}
                    />
                  ))}
                </div>
                {page < totalPages && !moviesLoading && (
                  <div className="load-more-container">
                    <button className="load-more-btn" onClick={() => fetchBrowse(selectedGenres, page + 1)} disabled={loadingMore}>
                      {loadingMore
                        ? <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                        : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── Hero Banner + Browse Sections ── */}
        {showSections && (
          <>
            {/* Hero Banner */}
            {trendingLoading && (
              <div className="hero-banner skel-hero">
                <Skeleton width="100%" height="100%" radius={0} />
                <div className="skel-hero-content">
                  <Skeleton width="60%" height={24} radius={4} />
                  <Skeleton width="35%" height={14} radius={4} style={{ marginTop: 8 }} />
                  <Skeleton width={100} height={36} radius={10} style={{ marginTop: 14 }} />
                </div>
              </div>
            )}
            {!trendingLoading && heroMovies.length > 0 && (
              <div className="hero-banner">
                  {heroMovies.map((movie, i) => {
                    const isCurrent = i === heroIndex;
                    const trailerUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(movie.title + " official trailer")}`;
                    const isHeroSaved = savedIds.has(movie.id);
                    return (
                      <div key={movie.id} className={`hero-slide ${isCurrent ? 'active' : ''}`}>
                        {movie.backdrop_path && (
                          <img src={`${IMG_BASE}/original${movie.backdrop_path}`} alt="" className="hero-slide-bg" />
                        )}
                        <div className="hero-gradient" />
                        <div className="hero-content">
                          <div className="hero-bottom-row">
                            <div className="hero-bottom-left">
                              <h2 className="hero-title">{movie.title}</h2>
                              <div className="hero-actions">
                                <a
                                  className="hero-btn hero-btn-trailer"
                                  href={trailerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                                  Watch Trailer
                                </a>
                                <button
                                  className={`hero-btn hero-btn-watchlist${isHeroSaved ? " saved" : ""}`}
                                  onClick={(e) => { e.stopPropagation(); toggleSave(movie); }}
                                >
                                  {isHeroSaved ? "✓ Watchlist" : "+ Watchlist"}
                                </button>
                                <button
                                  className="hero-btn hero-btn-details"
                                  onClick={(e) => { e.stopPropagation(); setSelectedMovie(movie); }}
                                >
                                  More info
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {/* Editorial + Dashboard Cards — side by side when there's taste content */}
            <div className={`home-dashboard${hasEditorial ? " home-dashboard-split" : ""}`}>
              {hasEditorial && (
                <div className="home-dashboard-left">
                  <YourTasteSection
                    user={user}
                    getAccessToken={getAccessToken}
                    watchedMovies={watchedMovies}
                    watchedDates={watchedDates}
                    watchedRatings={watchedRatings}
                    goToJournal={goToJournal}
                  />
                </div>
              )}
              <div className="home-dashboard-right">
                <div className="home-dashboard-right-top">
                  <YourReelCard
                    watchedDates={watchedDates}
                    watchedRatings={watchedRatings}
                    watchedMovies={watchedMovies}
                  />
                  <CinnoCompanionCard
                    goToCompanion={goToCompanion}
                    startCinnoChat={startCinnoChat}
                  />
                </div>
                <CinnoPickCard
                  user={user}
                  isGuest={isGuest}
                  getAccessToken={getAccessToken}
                  watchedIds={watchedIds}
                  savedIds={savedIds}
                  savedMovies={savedMovies}
                  listsLoading={listsLoading}
                  toggleSave={toggleSave}
                  setSelectedMovie={setSelectedMovie}
                />
              </div>
            </div>

            {/* Browse Sections — stacked full-width */}
            <div className="browse-sections">
              <div className="browse-section">
                <div className="browse-section-header browse-section-header-v2">
                  <div className="browse-section-titles">
                    <div className="browse-section-eyebrow">— CURATED · {DateTime.now().toFormat("LLL yyyy").toUpperCase()} —</div>
                    <div className="browse-section-title">Everyone's Watching</div>
                  </div>
                  <div className="browse-section-actions">
                    <button className="desktop-refresh-btn" onClick={handleDesktopRefresh} disabled={refreshing} title="Refresh">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "spinning" : ""}>
                        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                      </svg>
                    </button>
                  </div>
                </div>
                {trendingLoading ? (
                  <div className="scroll-row"><div className="scroll-row-inner"><SkeletonScrollRow /></div></div>
                ) : trendingError ? (
                  <div className="error-card compact">
                    <div className="error-card-title">Couldn't load this section</div>
                    <button className="error-card-btn" onClick={() => fetchAllSections()}>Retry</button>
                  </div>
                ) : (
                  <ScrollRow>
                    {trendingMovies.map((movie, i) => (
                      <MovieTile
                        key={movie.id}
                        movie={{ ...movie, _idx: i }}
                        isSaved={savedIds.has(movie.id)}
                        onToggleSave={toggleSave}
                        onClick={() => setSelectedMovie(movie)}
                        className="scroll-tile"
                        style={{ "--i": Math.min(i, 10) }}
                      />
                    ))}
                  </ScrollRow>
                )}
              </div>

              {user && recentMovie && (pickedLoading || pickedMovies.length > 0) && (
                <div className="browse-section">
                  <div className="browse-section-header browse-section-header-v2">
                    <div className="browse-section-titles">
                      <div className="browse-section-eyebrow">— PICKED FOR YOU —</div>
                      <div className="browse-section-title">Because you watched {recentMovie.title}</div>
                    </div>
                  </div>
                  {pickedLoading ? (
                    <div className="scroll-row"><div className="scroll-row-inner"><SkeletonScrollRow /></div></div>
                  ) : (
                    <ScrollRow>
                      {pickedMovies.map((movie, i) => (
                        <MovieTile
                          key={movie.id}
                          movie={{ ...movie, _idx: i }}
                          isSaved={savedIds.has(movie.id)}
                          onToggleSave={toggleSave}
                          onClick={() => setSelectedMovie(movie)}
                          className="scroll-tile"
                          style={{ "--i": Math.min(i, 10) }}
                        />
                      ))}
                    </ScrollRow>
                  )}
                </div>
              )}

              {!popularFailed && (popularLoading || popularFiltered.length > 0) && (
                <div className="browse-section">
                  <div className="browse-section-header browse-section-header-v2">
                    <div className="browse-section-titles">
                      <div className="browse-section-eyebrow">— POPULAR RIGHT NOW —</div>
                      <div className="browse-section-title">{user ? "You haven't seen these yet" : "Popular right now"}</div>
                    </div>
                  </div>
                  {popularLoading ? (
                    <div className="scroll-row"><div className="scroll-row-inner"><SkeletonScrollRow /></div></div>
                  ) : (
                    <ScrollRow>
                      {popularFiltered.map((movie, i) => (
                        <MovieTile
                          key={movie.id}
                          movie={{ ...movie, _idx: i }}
                          isSaved={savedIds.has(movie.id)}
                          onToggleSave={toggleSave}
                          onClick={() => setSelectedMovie(movie)}
                          className="scroll-tile"
                          style={{ "--i": Math.min(i, 10) }}
                        />
                      ))}
                    </ScrollRow>
                  )}
                </div>
              )}

              <JournalRecentSection
                watchedMovies={watchedMovies}
                watchedDates={watchedDates}
                watchedRatings={watchedRatings}
                watchedNotes={watchedNotes}
                onCardClick={setJournalSelected}
                goToJournal={goToJournal}
              />
            </div>
          </>
        )}
      </div>
      {selectedMovie && (
        <MovieModal
          key={selectedMovie.id}
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          isSaved={savedIds.has(selectedMovie.id)}
          onToggleSave={toggleSave}
          onMovieSelect={setSelectedMovie}
          savedIds={savedIds}
          isWatched={watchedIds.has(selectedMovie.id)}
          onToggleWatched={toggleWatched}
          onStartDebrief={startDebrief}
          collections={collections}
          toggleMovieInCollection={toggleMovieInCollection}
          rating={watchedRatings?.get(selectedMovie.id) ?? null}
          onSetRating={setWatchedRating}
        />
      )}
      {journalSelected && (
        <JournalDetailModal
          key={journalSelected.id}
          movie={journalSelected}
          onClose={() => setJournalSelected(null)}
          note={watchedNotes?.get(journalSelected.id) || ""}
          onSaveNote={setWatchedNote}
          isSaved={savedIds.has(journalSelected.id)}
          onToggleSave={toggleSave}
          onToggleWatched={toggleWatched}
          rating={watchedRatings?.get(journalSelected.id) ?? null}
          onSetRating={setWatchedRating}
          onStartDebrief={startDebrief}
        />
      )}
    </>
  );
}

// ─── Share Icons ────────────────────────────────────────────────────────────────

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const LinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
  </svg>
);

// ─── Share Watchlist Modal ──────────────────────────────────────────────────────

function ShareWatchlistModal({ onClose, savedMovies }) {
  const [copied, setCopied] = useState(false);

  const ids = Array.from(savedMovies.keys());
  const shareUrl = useMemo(() => {
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("shared", ids.join(","));
    return url.toString();
  }, [ids]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      Toast.fire({ icon: "success", title: "Copied to clipboard" });
    } catch {
      const input = document.createElement("textarea");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      Toast.fire({ icon: "success", title: "Copied to clipboard" });
    }
  };

  const { modalRef, overlayRef, animatedClose, swipeHandlers } = useSwipeToDismiss(onClose);

  return createPortal(
    <div className="movie-modal-overlay" ref={overlayRef} onClick={animatedClose}>
      <div className="share-modal" ref={modalRef} {...swipeHandlers} onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle-bar"><div className="modal-handle" /></div>
        <button className="modal-close-btn" onClick={animatedClose}>✕</button>
        <div className="share-modal-icon">
          <LinkIcon />
        </div>
        <div className="share-modal-title">Share Your Watchlist</div>
        <div className="share-modal-desc">
          Anyone with this link can browse your {ids.length} saved movie{ids.length !== 1 ? "s" : ""}.
        </div>
        <div className="share-link-box">
          <div className="share-link-text">{shareUrl}</div>
        </div>
        <button className={`share-copy-btn ${copied ? "copied" : ""}`} onClick={handleCopy}>
          {copied ? (
            <>
              <CheckIcon />
              Copied!
            </>
          ) : (
            <>
              <CopyIcon />
              Copy link
            </>
          )}
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── Shared Watchlist View (read-only standalone page) ──────────────────────────

function SharedWatchlistView() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedMovie, setSelectedMovie] = useMovieModal();
  const closeSharedDetail = useCallback(() => setSelectedMovie(null), []);
  const { modalRef, overlayRef, swipeHandlers } = useSwipeToDismiss(closeSharedDetail);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", loadFromStorage("cc_theme", "dark"));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("shared");
    if (!shared) { setLoading(false); setError(true); return; }
    const ids = shared.split(",").filter(Boolean).map(Number).filter((n) => n > 0);
    if (ids.length === 0) { setLoading(false); setError(true); return; }

    Promise.allSettled(ids.map((id) => getMovieById(id)))
      .then((results) => {
        const loaded = results
          .filter((r) => r.status === "fulfilled")
          .map((r, i) => ({ ...r.value, _idx: i }));
        setMovies(loaded);
        setLoading(false);
      })
      .catch(() => { setLoading(false); setError(true); });
  }, []);

  return (
    <div className="shared-page">
      <div className="shared-header">
        <div className="shared-header-inner">
          <div className="header-title">
            <CinnoLogo size={28} />
            Cinno
          </div>
        </div>
      </div>
      <div className="shared-hero">
        <div className="shared-hero-label">Shared Watchlist</div>
        <div className="shared-hero-title">Someone's Watchlist</div>
        {!loading && !error && (
          <div className="shared-hero-count">{movies.length} movie{movies.length !== 1 ? "s" : ""}</div>
        )}
      </div>
      <div className="shared-content">
        {loading ? (
          <div className="movies-grid">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="skeleton-tile">
                <div className="skeleton-poster" />
                <div className="skeleton-title" />
              </div>
            ))}
          </div>
        ) : error || movies.length === 0 ? (
          <div className="saved-empty">
            <div className="saved-icon">🔗</div>
            <div className="saved-title">Invalid share link</div>
            <div className="saved-desc">This link doesn't contain a valid watchlist.</div>
          </div>
        ) : (
          <div className="movies-grid">
            {movies.map((movie) => (
              <div
                key={movie.id}
                className="movie-tile"
                onClick={() => setSelectedMovie(movie)}
              >
                <div className="movie-poster">
                  <PosterImage posterPath={movie.poster_path} title={movie.title} />
                  <span className="movie-poster-rating" style={{ color: getRatingColor(movie.rating) }}>★ {movie.rating}</span>
                </div>
                <div className="movie-tile-title">{movie.title}</div>
                <div className="movie-tile-genre" style={{ color: GENRE_COLORS[movie.genre] || "#7A7878" }}>{movie.genre}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedMovie && createPortal(
        <div className="movie-modal-overlay" ref={overlayRef} onClick={closeSharedDetail}>
          <div className="shared-detail-modal" ref={modalRef} {...swipeHandlers} onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle-bar"><div className="modal-handle" /></div>
            <button className="modal-close-btn" onClick={closeSharedDetail}>✕</button>
            {selectedMovie.backdrop_path && (
              <div className="modal-backdrop">
                <img src={`${IMG_BASE}/w780${selectedMovie.backdrop_path}`} alt={selectedMovie.title} />
                <div className="modal-backdrop-fade" />
              </div>
            )}
            <div className="shared-detail-body">
              <div className="modal-top-row">
                <div className="modal-poster">
                  <PosterImage posterPath={selectedMovie.poster_path} title={selectedMovie.title} />
                </div>
                <div className="modal-info">
                  <div className="modal-title">{selectedMovie.title}</div>
                  <div className="modal-meta">
                    <span className="modal-year">{selectedMovie.year}</span>
                    <span className="modal-rating" style={{ color: getRatingColor(selectedMovie.rating) }}>★ {selectedMovie.rating}</span>
                    <span className="modal-genre" style={{
                      color: GENRE_COLORS[selectedMovie.genre] || "#7A7878",
                      background: (GENRE_COLORS[selectedMovie.genre] || "#7A7878") + "18"
                    }}>
                      {selectedMovie.genre}
                    </span>
                  </div>
                </div>
              </div>
              <p className="modal-synopsis">{selectedMovie.synopsis}</p>
            </div>
          </div>
        </div>,
        document.body
      )}

      <div className="shared-footer">
        Made with Cinno
      </div>
    </div>
  );
}

// ─── Saved Tab ─────────────────────────────────────────────────────────────────

function CreateCollectionModal({ onClose, onCreate }) {
  const [name, setName] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const { modalRef, overlayRef, animatedClose, swipeHandlers } = useSwipeToDismiss(onClose);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    onClose();
  };

  return createPortal(
    <div className="movie-modal-overlay" ref={overlayRef} onClick={animatedClose}>
      <div className="collection-create-modal" ref={modalRef} {...swipeHandlers} onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle-bar"><div className="modal-handle" /></div>
        <div className="collection-create-header">New Collection</div>
        <input
          ref={inputRef}
          className="collection-create-input"
          type="text"
          placeholder="Collection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          maxLength={40}
        />
        <div className="collection-create-actions">
          <button className="collection-create-cancel" onClick={onClose}>Cancel</button>
          <button className="collection-create-submit" disabled={!name.trim()} onClick={handleSubmit}>Create</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CollectionCard({ collection, savedMovies, onClick, onShare }) {
  const previewMovies = collection.movieIds
    .slice(0, 3)
    .map((id) => savedMovies.get(id))
    .filter(Boolean);

  return (
    <div className="collection-card scroll-tile" onClick={onClick}>
      {onShare && (
        <button className="collection-share-btn" onClick={onShare} title={`Share "${collection.name}"`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}
      <div className="collection-card-posters">
        {previewMovies.length > 0 ? (
          previewMovies.map((m, i) => (
            <div
              key={m.id}
              className="collection-poster-thumb"
              style={{
                zIndex: 3 - i,
                transform: `translateX(${i * 18}px) rotate(${i === 0 ? -3 : i === 1 ? 1 : 4}deg)`,
              }}
            >
              <img src={`${IMG_BASE}/w154${m.poster_path}`} alt={m.title} />
            </div>
          ))
        ) : (
          <div className="collection-poster-empty">
            {collection.isDefault ? <HeartIcon /> : <FolderIcon />}
          </div>
        )}
      </div>
      <div className="collection-card-name">{collection.name}</div>
      <div className="collection-card-count">{collection.movieIds.length} movie{collection.movieIds.length !== 1 ? "s" : ""}</div>
    </div>
  );
}

function CollectionDetailView({ collection, savedMovies, savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, onBack, onRename, onDelete, onShare, collections, toggleMovieInCollection, watchedRatings, setWatchedRating }) {
  const [selectedMovie, setSelectedMovie] = useMovieModal();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(collection.name);
  const editRef = useRef(null);

  useEffect(() => { if (editing) editRef.current?.focus(); }, [editing]);

  const movies = collection.movieIds
    .map((id) => savedMovies.get(id))
    .filter(Boolean)
    .map((m, i) => ({ ...m, _idx: i }));

  const handleSaveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== collection.name) onRename(collection.id, trimmed);
    else setEditName(collection.name);
    setEditing(false);
  };

  return (
    <>
      <div className="content">
        <div className="collection-detail-header">
          <button className="collection-back-btn" onClick={onBack}>
            <ChevronLeftIcon />
          </button>
          <div className="collection-detail-title-area">
            {editing ? (
              <input
                ref={editRef}
                className="collection-rename-input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") { setEditName(collection.name); setEditing(false); } }}
                maxLength={40}
              />
            ) : (
              <div className="collection-detail-title" onClick={() => !collection.isDefault && setEditing(true)}>
                {collection.name}
                {!collection.isDefault && <span className="collection-edit-icon"><PencilIcon /></span>}
              </div>
            )}
            <div className="collection-detail-count">{movies.length} movie{movies.length !== 1 ? "s" : ""}</div>
          </div>
          <div className="collection-detail-actions">
            {onShare && (
              <button className="collection-share-detail-btn" onClick={onShare} title="Share collection">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                  <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
            )}
            {!collection.isDefault && (
              <button className="collection-delete-btn" onClick={() => onDelete(collection.id, onBack)}>
                <TrashIcon />
              </button>
            )}
          </div>
        </div>
        {movies.length === 0 ? (
          <div className="saved-empty">
            <div className="saved-icon">{collection.isDefault ? "❤️" : "📁"}</div>
            <div className="saved-title">No movies yet</div>
            <div className="saved-desc">Add movies from the movie detail view.</div>
          </div>
        ) : (
          <div className="movies-grid">
            {movies.map((movie) => (
              <MovieTile
                key={movie.id}
                movie={movie}
                isSaved={savedIds.has(movie.id)}
                onToggleSave={toggleSave}
                onClick={() => setSelectedMovie(movie)}
              />
            ))}
          </div>
        )}
      </div>
      {selectedMovie && (
        <MovieModal
          key={selectedMovie.id}
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          isSaved={savedIds.has(selectedMovie.id)}
          onToggleSave={toggleSave}
          onMovieSelect={setSelectedMovie}
          savedIds={savedIds}
          isWatched={watchedIds.has(selectedMovie.id)}
          onToggleWatched={toggleWatched}
          onStartDebrief={startDebrief}
          collections={collections}
          toggleMovieInCollection={toggleMovieInCollection}
          rating={watchedRatings?.get(selectedMovie.id) ?? null}
          onSetRating={setWatchedRating}
        />
      )}
    </>
  );
}

function SavedTab({ savedIds, toggleSave, savedMovies, watchedIds, toggleWatched, startDebrief, collections, createCollection, renameCollection, deleteCollection, toggleMovieInCollection, onStartMoviePicker, scrollPositions, watchedRatings, setWatchedRating, listsLoading }) {
  const [selectedMovie, setSelectedMovie] = useMovieModal();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeCollection, setActiveCollection] = useState(null);
  const [watchlistView, setWatchlistView] = useState("grid");
  const [tonightPickId, setTonightPickId] = useState(() => loadFromStorage("cc_tonightPickId", null));
  const savedContentRef = useScrollRestore("saved", scrollPositions);

  // Re-trigger AOS animations after view toggle so the grid doesn't stay invisible
  useEffect(() => { setTimeout(() => AOS.refresh(), 60); }, [watchlistView]);

  const movies = useMemo(
    () => Array.from(savedMovies.values()).map((m, i) => ({ ...m, _idx: i })),
    [savedMovies]
  );

  // Runtime data lives in localStorage and is shared with the Journal tab.
  // We keep a local mirror so missing runtimes fetched from TMDB are reflected
  // immediately in stats / headline / hero meta without a remount.
  const [runtimeCache, setRuntimeCache] = useState(() => loadFromStorage("cc_runtimeCache", {}));
  const runtimeFetchAttempted = useRef(new Set());

  // Persist runtime cache on update (same storage key the Journal tab uses).
  useEffect(() => { saveToStorage("cc_runtimeCache", runtimeCache); }, [runtimeCache]);

  // Fetch missing runtimes from TMDB in parallel — display enrichment only,
  // never written back to Supabase. Skips films we've already attempted (so a
  // null result doesn't loop) and films with a cached runtime > 0.
  useEffect(() => {
    if (!savedMovies || savedMovies.size === 0) return;
    const ids = Array.from(savedMovies.keys());
    const missing = ids.filter((id) => {
      const cached = runtimeCache[id];
      if (typeof cached === "number" && cached > 0) return false;
      if (runtimeFetchAttempted.current.has(id)) return false;
      return true;
    });
    if (missing.length === 0) return;
    missing.forEach((id) => runtimeFetchAttempted.current.add(id));
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        missing.map((id) =>
          getMovieDetails(id)
            .then((d) => ({ id, runtime: d?.runtime || null }))
            .catch(() => ({ id, runtime: null }))
        )
      );
      if (cancelled) return;
      const batch = {};
      results.forEach((r) => {
        if (typeof r.runtime === "number" && r.runtime > 0) batch[r.id] = r.runtime;
      });
      if (Object.keys(batch).length > 0) {
        setRuntimeCache((prev) => ({ ...prev, ...batch }));
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMovies]);

  // Tonight's Pick — shared with Home tab via cc_tonightPickId.
  const tonightPickMovie = useMemo(() => {
    if (movies.length === 0) return null;
    if (tonightPickId && savedMovies.has(tonightPickId)) return savedMovies.get(tonightPickId);
    return movies[0] || null;
  }, [movies, tonightPickId, savedMovies]);

  const shuffleTonightPick = () => {
    if (movies.length <= 1) return;
    const others = movies.filter((m) => m.id !== (tonightPickMovie?.id));
    if (others.length === 0) return;
    const pick = others[Math.floor(Math.random() * others.length)];
    setTonightPickId(pick.id);
    saveToStorage("cc_tonightPickId", pick.id);
  };

  // Clear stored pick if its film was removed from the watchlist.
  useEffect(() => {
    if (tonightPickId && !savedMovies.has(tonightPickId)) {
      setTonightPickId(null);
      removeFromStorage("cc_tonightPickId");
    }
  }, [tonightPickId, savedMovies]);

  // AI reasoning quote — read from CinnoPickCard's localStorage cache if available.
  const tonightPickReason = useMemo(() => {
    if (!tonightPickMovie) return null;
    const today = DateTime.now().toFormat("yyyy-MM-dd");
    const cached = loadFromStorage(`cc_cinno_pick_${today}_${tonightPickMovie.id}`, null);
    if (cached?.reason) return cached.reason;
    // Fallback: days-since-added phrasing
    if (tonightPickMovie.savedAt) {
      const t = DateTime.fromISO(tonightPickMovie.savedAt);
      if (t.isValid) {
        const days = Math.max(0, Math.floor(DateTime.now().diff(t, "days").days));
        return `Added ${days} day${days === 1 ? "" : "s"} ago — tonight feels right.`;
      }
    }
    return "Tonight feels right.";
  }, [tonightPickMovie]);

  const trailerUrl = useMemo(() => {
    if (!tonightPickMovie) return "#";
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(tonightPickMovie.title + " official trailer")}`;
  }, [tonightPickMovie]);

  // Aggregate stats for the page header strip + headline.
  // Films with missing/null runtime are excluded from the runtime sum entirely
  // (not counted as 0). If every runtime is missing, display "?" instead of 0.
  const watchlistStats = useMemo(() => {
    let totalMinutes = 0;
    let countedWithRuntime = 0;
    movies.forEach((m) => {
      const rt = runtimeCache[m.id];
      if (typeof rt === "number" && rt > 0) {
        totalMinutes += rt;
        countedWithRuntime += 1;
      }
    });
    let oldest = null;
    movies.forEach((m) => {
      if (!m.savedAt) return;
      const t = DateTime.fromISO(m.savedAt);
      if (t.isValid && (!oldest || t < oldest)) oldest = t;
    });
    const oldestMonths = oldest ? Math.max(0, Math.floor(DateTime.now().diff(oldest, "months").months)) : 0;
    const totalHours = countedWithRuntime > 0 ? Math.floor(totalMinutes / 60) : "?";
    return {
      count: movies.length,
      totalHours,
      oldestMonths,
    };
  }, [movies, runtimeCache]);

  // "Sitting too long" — films saved more than 60 days ago, oldest first, capped at 6.
  const sittingTooLong = useMemo(() => {
    return movies
      .filter((m) => {
        if (!m.savedAt) return false;
        const t = DateTime.fromISO(m.savedAt);
        return t.isValid && DateTime.now().diff(t, "days").days > 60;
      })
      .sort((a, b) => (a.savedAt || "").localeCompare(b.savedAt || ""))
      .slice(0, 6);
  }, [movies]);

  const handleShareCollection = async (e, collection) => {
    e.stopPropagation();
    const ids = collection.movieIds.filter((id) => savedMovies.has(id));
    if (ids.length === 0) { Toast.fire({ icon: "info", title: "Collection is empty" }); return; }
    const url = new URL(window.location.origin + window.location.pathname);
    url.searchParams.set("shared", ids.join(","));
    try {
      await navigator.clipboard.writeText(url.toString());
      Toast.fire({ icon: "success", title: `Copied link for "${collection.name}"` });
    } catch {
      const input = document.createElement("textarea");
      input.value = url.toString();
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      Toast.fire({ icon: "success", title: `Copied link for "${collection.name}"` });
    }
  };

  const viewingCollection = activeCollection ? collections.find((c) => c.id === activeCollection) : null;

  if (viewingCollection) {
    return (
      <CollectionDetailView
        collection={viewingCollection}
        savedMovies={savedMovies}
        savedIds={savedIds}
        toggleSave={toggleSave}
        watchedIds={watchedIds}
        toggleWatched={toggleWatched}
        startDebrief={startDebrief}
        onBack={() => setActiveCollection(null)}
        onRename={renameCollection}
        onDelete={deleteCollection}
        onShare={(e) => handleShareCollection(e, viewingCollection)}
        collections={collections}
        toggleMovieInCollection={toggleMovieInCollection}
        watchedRatings={watchedRatings}
        setWatchedRating={setWatchedRating}
      />
    );
  }

  const tonightRuntime = tonightPickMovie ? runtimeCache[tonightPickMovie.id] : null;
  const tonightRuntimeLabel = formatRuntime(tonightRuntime);

  return (
    <>
      <div className="content wl-content" ref={savedContentRef}>
        {movies.length === 0 && listsLoading ? (
          <SkeletonGrid count={9} />
        ) : movies.length === 0 ? (
          /* SECTION 7 — EMPTY STATE */
          <div className="wl-empty">
            <div className="wl-empty-left">
              <div className="wl-empty-eyebrow">EMPTY FOLDER · ALL</div>
              <h2 className="wl-empty-headline">
                Nothing saved yet.
                <span className="wl-empty-headline-italic"> Let's fix that.</span>
              </h2>
              <p className="wl-empty-body">
                Ask Cinno for tonight's pick, or jump into Discover to start building a list of films that feel like you.
              </p>
              <div className="wl-empty-ctas">
                <button className="wl-empty-cta-primary" onClick={() => {}}>Ask Cinno</button>
                <button className="wl-empty-cta-secondary" onClick={() => {}}>Browse Discover</button>
              </div>
            </div>
            <div className="wl-empty-right">
              <div className="wl-empty-fan" />
              <div className="wl-empty-fan" />
              <div className="wl-empty-fan" />
              <div className="wl-empty-fan" />
            </div>
          </div>
        ) : (
          <>
            {/* SECTION 1 — TONIGHT'S PICK HERO */}
            {tonightPickMovie && (
              <div className="wl-tonight-hero" onClick={() => setSelectedMovie(tonightPickMovie)}>
                {(tonightPickMovie.backdrop_path || tonightPickMovie.poster_path) && (
                  <img
                    src={`${IMG_BASE}/w1280${tonightPickMovie.backdrop_path || tonightPickMovie.poster_path}`}
                    alt=""
                    className="wl-tonight-hero-bg"
                  />
                )}
                <div className="wl-tonight-hero-scrim" aria-hidden="true" />
                <div className="wl-tonight-hero-grid">
                  <div className="wl-tonight-hero-left">
                    <div className="wl-tonight-hero-eyebrow">
                      <span className="wl-tonight-hero-dot" aria-hidden="true" />
                      <span>TONIGHT&apos;S PICK · FOR TONIGHT</span>
                    </div>
                    <h2 className="wl-tonight-hero-title">{tonightPickMovie.title}</h2>
                    <div className="wl-tonight-hero-meta">
                      {tonightPickMovie.year && <span>{tonightPickMovie.year}</span>}
                      {tonightPickMovie.genre && <span>· {tonightPickMovie.genre}</span>}
                      {tonightPickMovie.rating && tonightPickMovie.rating !== "—" && <span>· ★ {tonightPickMovie.rating}</span>}
                      {tonightRuntimeLabel && <span>· {tonightRuntimeLabel}</span>}
                    </div>
                    {tonightPickReason && (
                      <p className="wl-tonight-hero-quote">{tonightPickReason}</p>
                    )}
                    <div className="wl-tonight-hero-actions">
                      <a
                        className="wl-tonight-hero-btn-primary"
                        href={trailerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        ▶ Watch Trailer
                      </a>
                      <button
                        className="wl-tonight-hero-btn-ghost"
                        onClick={(e) => { e.stopPropagation(); shuffleTonightPick(); }}
                      >
                        ↻ Pick again
                      </button>
                      <button
                        className="wl-tonight-hero-btn-ghost"
                        onClick={(e) => { e.stopPropagation(); setSelectedMovie(tonightPickMovie); }}
                      >
                        More info
                      </button>
                    </div>
                  </div>
                  <div className="wl-tonight-hero-right">
                    {tonightPickMovie.poster_path && (
                      <img
                        src={`${IMG_BASE}/w342${tonightPickMovie.poster_path}`}
                        alt=""
                        className="wl-tonight-hero-poster"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* SECTION 2 — PAGE HEADER + STAT STRIP */}
            <div className="wl-header">
              <div className="wl-eyebrow">
                <span className="wl-eyebrow-bar" aria-hidden="true" />
                <span>YOUR WATCHLIST</span>
              </div>
              <h1 className="wl-headline">
                {watchlistStats.count} film{watchlistStats.count === 1 ? "" : "s"} sit waiting — that&apos;s{" "}
                <span className="watchlist-accent">{watchlistStats.totalHours}h of you.</span>
              </h1>
            </div>

            <div className="wl-stat-strip">
              <div className="wl-stat">
                <div className="wl-stat-num">{watchlistStats.count}</div>
                <div className="wl-stat-label">Films to Watch</div>
              </div>
              <div className="wl-stat">
                <div className="wl-stat-num">{watchlistStats.totalHours}h</div>
                <div className="wl-stat-label">Total Runtime</div>
              </div>
              <div className="wl-stat">
                <div className="wl-stat-num wl-stat-num-warn">{watchlistStats.oldestMonths} mo</div>
                <div className="wl-stat-label">Oldest Unwatched</div>
              </div>
            </div>

            {/* SECTION 3 — FOLDER / COLLECTION BAR */}
            <div className="wl-folder-bar">
              <div className="wl-folder-bar-left">
                <button
                  className={`wl-folder-pill${activeCollection === null ? " active" : ""}`}
                  onClick={() => setActiveCollection(null)}
                >
                  <span>All</span>
                  <span className="wl-folder-count">{movies.length}</span>
                </button>
                {collections.map((col) => (
                  <button
                    key={col.id}
                    className={`wl-folder-pill${activeCollection === col.id ? " active" : ""}`}
                    onClick={() => setActiveCollection(col.id)}
                  >
                    <span>{col.name}</span>
                    <span className="wl-folder-count">{col.movieIds.length}</span>
                  </button>
                ))}
                <button className="wl-folder-pill wl-folder-pill-add" onClick={() => setShowCreateModal(true)}>
                  + New folder
                </button>
              </div>
              <div className="wl-folder-bar-right">
                <span className="wl-sort-label">SORT</span>
                <button className="wl-sort-pill" onClick={() => {}}>Recently added ▾</button>
                <div className="wl-view-toggle">
                  <button
                    className={`wl-view-toggle-btn${watchlistView === "grid" ? " active" : ""}`}
                    onClick={() => setWatchlistView("grid")}
                    title="Grid view"
                    aria-label="Grid view"
                  >▦</button>
                  <button
                    className={`wl-view-toggle-btn${watchlistView === "list" ? " active" : ""}`}
                    onClick={() => setWatchlistView("list")}
                    title="List view"
                    aria-label="List view"
                  >☰</button>
                </div>
              </div>
            </div>

            {/* SECTION 4 — MOVIE GRID */}
            {watchlistView === "grid" ? (
              <div className="wl-grid">
                {movies.map((movie) => {
                  return (
                    <div
                      key={movie.id}
                      className="wl-tile"
                      onClick={() => setSelectedMovie(movie)}
                    >
                      <div className="wl-tile-poster">
                        <div className="wl-tile-bookmark" aria-hidden="true" />
                        {movie.rating && movie.rating !== "—" && (
                          <span className="wl-tile-rating">★ {movie.rating}</span>
                        )}
                        <PosterImage posterPath={movie.poster_path} title={movie.title} />
                        <div className="wl-tile-overlay">
                          <div className="wl-tile-overlay-eyebrow">{movie.genre || "FILM"}{runtimeCache[movie.id] ? ` · ${formatRuntime(runtimeCache[movie.id])}` : ""}</div>
                          <div className="wl-tile-overlay-actions">
                            <button
                              className="wl-tile-overlay-remove"
                              onClick={(e) => { e.stopPropagation(); toggleSave(movie); }}
                              title="Remove from watchlist"
                              aria-label="Remove from watchlist"
                            >Remove from watchlist</button>
                          </div>
                        </div>
                      </div>
                      <div className="wl-tile-title">{movie.title}</div>
                      <div className="wl-tile-meta">{movie.year || ""}{movie.genre ? ` · ${movie.genre}` : ""}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="watchlist-list">
                {movies.map((movie) => {
                  const ratingColor = getRatingColor(movie.rating);
                  return (
                    <div key={movie.id} className="watchlist-list-item" onClick={() => setSelectedMovie(movie)}>
                      <div className="watchlist-list-poster">
                        <PosterImage posterPath={movie.poster_path} title={movie.title} />
                      </div>
                      <div className="watchlist-list-info">
                        <div className="watchlist-list-title">{movie.title}</div>
                        <div className="watchlist-list-meta">{movie.genre} · {movie.year}</div>
                      </div>
                      <div className="watchlist-list-rating" style={{ color: ratingColor }}>★ {movie.rating}</div>
                      <button
                        className="save-btn saved watchlist-list-bookmark"
                        onClick={(e) => { e.stopPropagation(); toggleSave(movie); }}
                        title="Remove from watchlist"
                      >
                        <BookmarkIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* SECTION 5 — SITTING TOO LONG */}
            {sittingTooLong.length > 0 && (
              <div className="wl-sitting">
                <div className="wl-sitting-header">
                  <div className="wl-sitting-header-left">
                    <div className="wl-eyebrow">
                      <span className="wl-eyebrow-bar" aria-hidden="true" />
                      <span>SITTING TOO LONG</span>
                    </div>
                    <h2 className="wl-sitting-headline">Some films have been waiting a while.</h2>
                  </div>
                  <button className="wl-sitting-rerank" onClick={() => {}}>
                    <span className="wl-sitting-rerank-dot" aria-hidden="true" />
                    Re-rank with Cinno
                  </button>
                </div>
                <div className="wl-sitting-grid">
                  {sittingTooLong.map((movie) => {
                    const t = DateTime.fromISO(movie.savedAt);
                    const months = t.isValid ? Math.max(1, Math.floor(DateTime.now().diff(t, "months").months)) : 0;
                    const rt = runtimeCache[movie.id];
                    return (
                      <div key={movie.id} className="wl-sitting-card">
                        <div className="wl-sitting-card-poster">
                          <PosterImage posterPath={movie.poster_path} title={movie.title} />
                        </div>
                        <div className="wl-sitting-card-info">
                          <div className="wl-sitting-card-top">
                            <div className="wl-sitting-card-eyebrow">
                              <span className="wl-sitting-card-dot" aria-hidden="true" />
                              <span>SITTING {months} MONTH{months === 1 ? "" : "S"}</span>
                            </div>
                            <div className="wl-sitting-card-title">{movie.title}</div>
                            <div className="wl-sitting-card-meta">
                              {movie.year || ""}{movie.genre ? ` · ${movie.genre}` : ""}{rt ? ` · ${formatRuntime(rt)}` : ""}
                            </div>
                          </div>
                          <div className="wl-sitting-card-actions">
                            <button
                              className="wl-sitting-card-watch"
                              onClick={(e) => { e.stopPropagation(); setSelectedMovie(movie); }}
                            >▶ Watch</button>
                            <button
                              className="wl-sitting-card-remove"
                              onClick={(e) => { e.stopPropagation(); toggleSave(movie); }}
                            >Remove</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* SECTION 6 — FLOATING CINNO BUTTON */}
      <button className="wl-fab" onClick={onStartMoviePicker} title="Cinno picker" aria-label="Open Cinno picker">
        ✦
      </button>

      {selectedMovie && (
        <MovieModal
          key={selectedMovie.id}
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          isSaved={savedIds.has(selectedMovie.id)}
          onToggleSave={toggleSave}
          onMovieSelect={setSelectedMovie}
          savedIds={savedIds}
          isWatched={watchedIds.has(selectedMovie.id)}
          onToggleWatched={toggleWatched}
          onStartDebrief={startDebrief}
          collections={collections}
          toggleMovieInCollection={toggleMovieInCollection}
          rating={watchedRatings?.get(selectedMovie.id) ?? null}
          onSetRating={setWatchedRating}
        />
      )}
      {showCreateModal && (
        <CreateCollectionModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createCollection}
        />
      )}
    </>
  );
}

// ─── Stats View (Editorial layout) ─────────────────────────────────────────────

function formatHours(totalMinutes, missing) {
  if (missing) return "—";
  if (!totalMinutes || totalMinutes <= 0) return "—";
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function StatsView({ watchedMovies, watchedRatings, watchedDates }) {
  const stats = useMemo(() => {
    const movies = Array.from(watchedMovies?.values() || []);
    const total = movies.length;

    // Hours from runtime cache
    const runtimeCache = loadFromStorage("cc_runtimeCache", {});
    let totalMinutes = 0;
    let missing = false;
    movies.forEach((m) => {
      const r = runtimeCache[m.id];
      if (typeof r === "number" && r > 0) totalMinutes += r;
      else if (total > 0) missing = true;
    });

    // Average rating
    const ratings = [];
    watchedRatings?.forEach((r) => { if (typeof r === "number") ratings.push(r); });
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;

    // Longest streak (count consecutive days from any starting point)
    const watchedDays = new Set();
    watchedDates?.forEach((dateStr) => { if (dateStr) watchedDays.add(dateStr.slice(0, 10)); });
    let longest = 0;
    if (watchedDays.size > 0) {
      const sortedDays = Array.from(watchedDays).sort();
      let run = 1;
      longest = 1;
      for (let i = 1; i < sortedDays.length; i++) {
        const prev = DateTime.fromISO(sortedDays[i - 1]);
        const cur = DateTime.fromISO(sortedDays[i]);
        if (prev.isValid && cur.isValid && cur.diff(prev, "days").days === 1) {
          run += 1;
          if (run > longest) longest = run;
        } else {
          run = 1;
        }
      }
    }

    // Genre breakdown
    const genreCounts = {};
    movies.forEach((m) => {
      const g = m?.genre;
      if (!g || g === "Film") return;
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    });
    const genreEntries = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const genreMax = genreEntries[0]?.[1] || 1;

    // Rating distribution: 10 buckets [0-10, 11-20, ... 91-100]
    const buckets = Array.from({ length: 10 }, (_, i) => ({
      label: i === 0 ? "0–10" : `${i * 10 + 1}–${(i + 1) * 10}`,
      lo: i === 0 ? 0 : i * 10 + 1,
      hi: (i + 1) * 10,
      count: 0,
    }));
    ratings.forEach((r) => {
      const idx = Math.min(9, r === 0 ? 0 : Math.floor((r - 1) / 10));
      buckets[idx].count += 1;
    });
    const bucketMax = Math.max(1, ...buckets.map((b) => b.count));

    return {
      total,
      hoursLabel: formatHours(totalMinutes, missing),
      avgRating: avgRating !== null ? avgRating.toFixed(1) : "—",
      longest,
      genreEntries,
      genreMax,
      buckets,
      bucketMax,
      avgRatingRaw: avgRating,
      hasRatings: ratings.length > 0,
    };
  }, [watchedMovies, watchedRatings, watchedDates]);

  if (stats.total < 3) {
    return (
      <div className="stats-empty">
        <div className="stats-empty-icon">🎬</div>
        <div className="stats-empty-title">Watch more movies to unlock your stats</div>
        <div className="stats-empty-desc">After 3 watched, this page lights up.</div>
      </div>
    );
  }

  return (
    <div className="stats-page">
      {/* Section 1 — Your numbers */}
      <section className="stats-section">
        <div className="browse-section-header browse-section-header-v2">
          <div className="browse-section-titles">
            <div className="browse-section-eyebrow">— ALL TIME —</div>
            <div className="browse-section-title">Your numbers</div>
          </div>
        </div>
        <div className="stats-numbers-grid">
          <div className="stats-metric">
            <div className="stats-metric-label">Films watched</div>
            <div className="stats-metric-value">{stats.total}</div>
          </div>
          <div className="stats-metric">
            <div className="stats-metric-label">Total hours</div>
            <div className="stats-metric-value">{stats.hoursLabel}</div>
          </div>
          <div className="stats-metric">
            <div className="stats-metric-label">Average rating</div>
            <div className="stats-metric-value">{stats.avgRating === "—" ? "—" : `${stats.avgRating}/100`}</div>
          </div>
          <div className="stats-metric">
            <div className="stats-metric-label">Longest streak</div>
            <div className="stats-metric-value">{stats.longest > 0 ? `${stats.longest} day${stats.longest === 1 ? "" : "s"}` : "—"}</div>
          </div>
        </div>
      </section>

      {/* Section 2 — Genre breakdown */}
      {stats.genreEntries.length > 0 && (
        <section className="stats-section">
          <div className="browse-section-header browse-section-header-v2">
            <div className="browse-section-titles">
              <div className="browse-section-eyebrow">— WHAT YOU WATCH —</div>
              <div className="browse-section-title">Genre breakdown</div>
            </div>
          </div>
          <div className="stats-genre-bars">
            {stats.genreEntries.map(([name, count]) => {
              const pct = (count / stats.genreMax) * 100;
              return (
                <div key={name} className="stats-genre-row">
                  <div className="stats-genre-label">{name}</div>
                  <div className="stats-genre-track">
                    <div className="stats-genre-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="stats-genre-count">{count}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Section 3 — Rating distribution */}
      {stats.hasRatings && (
        <section className="stats-section">
          <div className="browse-section-header browse-section-header-v2">
            <div className="browse-section-titles">
              <div className="browse-section-eyebrow">— HOW YOU RATE —</div>
              <div className="browse-section-title">Rating distribution</div>
            </div>
          </div>
          <div className="stats-rating-chart">
            <div className="stats-rating-bars">
              {stats.buckets.map((b, i) => {
                const pct = b.count === 0 ? 2 : Math.max(4, (b.count / stats.bucketMax) * 100);
                return (
                  <div key={b.label} className="stats-rating-col" title={`${b.count} movies`}>
                    <div className="stats-rating-bar-track">
                      <div className="stats-rating-bar" style={{ height: `${pct}%` }} />
                    </div>
                    <div className="stats-rating-label">{i % 2 === 0 ? b.label : ""}</div>
                  </div>
                );
              })}
            </div>
            {stats.avgRatingRaw !== null && (
              <div
                className="stats-rating-avg-line"
                style={{ left: `calc(${(stats.avgRatingRaw / 100) * 100}% - 1px)` }}
                aria-hidden="true"
              />
            )}
          </div>
          {stats.avgRatingRaw !== null && (
            <div className="stats-rating-avg-label">Your average: <strong>{stats.avgRating}</strong></div>
          )}
        </section>
      )}
    </div>
  );
}

// (Legacy bento-grid StatsView body removed — replaced by the editorial StatsView above.)

// ─── Journal Tab ───────────────────────────────────────────────────────────────

// Personal-rating colour buckets for poster overlays + ranking ring
function ratingTierColor(score) {
  if (typeof score !== "number") return null;
  if (score >= 90) return "#D4B05C"; // gold
  if (score >= 70) return "#8B2040"; // burgundy
  return "rgba(245, 240, 235, 0.45)"; // muted cream
}

function NoteIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

// Compact poster card used by the Journal poster wall.
// Personal rating surfaces in a hover-only gradient overlay (0-100 scale).
function JournalPosterCard({ movie, rating, onClick }) {
  const hasRating = typeof rating === "number";
  return (
    <button className="jp-card" onClick={onClick} type="button">
      <div className="jp-poster">
        <PosterImage posterPath={movie.poster_path} title={movie.title} />
        <div className="jp-hover-overlay">
          {hasRating && (
            <div className="jp-hover-score">
              <span className="jp-hover-score-num">{rating}</span>
              <span className="jp-hover-score-max">/100</span>
            </div>
          )}
        </div>
      </div>
      <div className="jp-title">{movie.title}</div>
    </button>
  );
}

// Group a sorted-by-date list into month buckets.
function groupByMonth(movies, watchedDates) {
  const groups = new Map(); // key: yyyy-MM, value: { label, movies: [] }
  movies.forEach((m) => {
    const ds = (watchedDates?.get(m.id) || "").slice(0, 10);
    const dt = ds ? DateTime.fromISO(ds) : null;
    const key = dt && dt.isValid ? dt.toFormat("yyyy-MM") : "—";
    let bucket = groups.get(key);
    if (!bucket) {
      const now = DateTime.now();
      let label = "Older";
      if (dt && dt.isValid) {
        if (dt.hasSame(now, "month")) label = "This month";
        else if (dt.year === now.year) label = dt.toFormat("LLLL");
        else label = dt.toFormat("LLLL yyyy");
      }
      bucket = { key, label, eyebrow: dt && dt.isValid ? dt.toFormat("LLLL yyyy").toUpperCase() : "UNDATED", movies: [] };
      groups.set(key, bucket);
    }
    bucket.movies.push(m);
  });
  return Array.from(groups.values());
}

// Same overlays as poster card, but a circle that sits over the corner of a small poster.
function PosterRatingDot({ rating, size = 32 }) {
  const tierColor = ratingTierColor(rating);
  if (typeof rating !== "number") return null;
  return (
    <span className="jp-rank-dot" style={{ width: size, height: size, borderColor: tierColor, color: tierColor }}>
      {rating}
    </span>
  );
}

// Resolves a movie's backdrop_path even if the cached watchedMovies entry is missing it.
// Persists the resolved path (or null) to localStorage so we don't re-fetch on every visit.
function useResolvedBackdrop(movie) {
  const [path, setPath] = useState(() => {
    if (movie?.backdrop_path) return movie.backdrop_path;
    if (!movie) return null;
    const cache = loadFromStorage("cc_backdrop_cache", {});
    return cache[movie.id] !== undefined ? cache[movie.id] : null;
  });

  useEffect(() => {
    if (!movie) { setPath(null); return; }
    if (movie.backdrop_path) { setPath(movie.backdrop_path); return; }
    const cache = loadFromStorage("cc_backdrop_cache", {});
    if (cache[movie.id] !== undefined) { setPath(cache[movie.id]); return; }

    let cancelled = false;
    getMovieDetails(movie.id)
      .then((d) => {
        if (cancelled) return;
        const resolved = d?.backdrop_path || null;
        const next = { ...loadFromStorage("cc_backdrop_cache", {}), [movie.id]: resolved };
        saveToStorage("cc_backdrop_cache", next);
        setPath(resolved);
      })
      .catch((err) => {
        console.error("[Rankings] backdrop fetch failed:", err?.message || err);
      });
    return () => { cancelled = true; };
  }, [movie?.id, movie?.backdrop_path]);

  return path;
}

// Cinematic rankings layout: #1 hero with backdrop, #2/#3 side-by-side, then numbered list.
function RankingsLayout({ ranked, watchedRatings, watchedDates, onOpen }) {
  if (ranked.length < 3) {
    return (
      <div className="rankings-list rankings-list-simple">
        {ranked.map((movie, i) => {
          const rank = i + 1;
          const r = watchedRatings.get(movie.id);
          return (
            <div key={movie.id} className="ranking-item" onClick={() => onOpen(movie)}>
              <span className="ranking-num">{rank}</span>
              <div className="ranking-poster">
                <PosterImage posterPath={movie.poster_path} title={movie.title} />
              </div>
              <div className="ranking-info">
                <div className="ranking-title">{movie.title}</div>
                <div className="ranking-meta">{movie.genre} · {movie.year}{watchedDates?.get(movie.id) ? ` · ${formatWatchDate(watchedDates.get(movie.id))}` : ""}</div>
              </div>
              <PosterRatingDot rating={r} size={36} />
            </div>
          );
        })}
      </div>
    );
  }

  const top1 = ranked[0];
  const top2 = ranked[1];
  const top3 = ranked[2];
  const rest = ranked.slice(3);
  const top1Rating = watchedRatings.get(top1.id);
  const top1BackdropPath = useResolvedBackdrop(top1);
  const heroBackdrop = top1BackdropPath ? `${IMG_BASE}/w1280${top1BackdropPath}` : null;

  return (
    <div className="rk-wrap">
      {/* #1 Hero */}
      <button className="rk-hero" onClick={() => onOpen(top1)} type="button">
        {heroBackdrop && <img src={heroBackdrop} alt="" className="rk-hero-bg" />}
        <div className="rk-hero-gradient" />
        <div className="rk-hero-content">
          <div className="rk-hero-poster">
            <PosterImage posterPath={top1.poster_path} title={top1.title} />
          </div>
          <div className="rk-hero-meta">
            <span className="rk-hero-badge">#1</span>
            <div className="rk-hero-eyebrow">Your all-time favourite</div>
            <h2 className="rk-hero-title">{top1.title}</h2>
            <div className="rk-hero-sub">
              {top1.genre} · {top1.year}
              {typeof top1Rating === "number" && (
                <span className="rk-hero-stars">
                  <span className="star-rating">
                    <span className="star-rating-bg">★★★★★</span>
                    <span className="star-rating-fg" style={{ width: `${top1Rating}%` }}>★★★★★</span>
                  </span>
                </span>
              )}
            </div>
          </div>
          {typeof top1Rating === "number" && (
            <div className="rk-hero-ring">
              <svg width="44" height="44" viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                <circle cx="22" cy="22" r="19" fill="none" stroke="#D4B05C" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 19}
                  strokeDashoffset={2 * Math.PI * 19 * (1 - top1Rating / 100)}
                  transform="rotate(-90 22 22)"
                />
                <text x="22" y="22" textAnchor="middle" dominantBaseline="central" fill="#D4B05C" fontSize="13" fontWeight="700" fontFamily="Plus Jakarta Sans, sans-serif">{top1Rating}</text>
              </svg>
            </div>
          )}
        </div>
      </button>

      {/* #2 + #3 row */}
      <div className="rk-podium">
        {[
          { movie: top2, rank: 2, color: "#C0C0C0" },
          { movie: top3, rank: 3, color: "#CD7F32" },
        ].map(({ movie, rank, color }) => {
          const r = watchedRatings.get(movie.id);
          return (
            <button key={movie.id} className="rk-podium-card" onClick={() => onOpen(movie)} type="button">
              <div className="rk-podium-poster" style={{ borderColor: color }}>
                <PosterImage posterPath={movie.poster_path} title={movie.title} />
              </div>
              <div className="rk-podium-info">
                <span className="rk-podium-badge" style={{ background: color, color: "#1A0A14" }}>#{rank}</span>
                <div className="rk-podium-title">{movie.title}</div>
                <div className="rk-podium-meta">{movie.genre} · {movie.year}</div>
              </div>
              <PosterRatingDot rating={r} size={32} />
            </button>
          );
        })}
      </div>

      {/* Remaining ranked list */}
      {rest.length > 0 && (
        <div className="rankings-list">
          {rest.map((movie, i) => {
            const rank = i + 4;
            const r = watchedRatings.get(movie.id);
            return (
              <div key={movie.id} className="ranking-item" onClick={() => onOpen(movie)}>
                <span className="ranking-num">{rank}</span>
                <div className="ranking-poster">
                  <PosterImage posterPath={movie.poster_path} title={movie.title} />
                </div>
                <div className="ranking-info">
                  <div className="ranking-title">{movie.title}</div>
                  <div className="ranking-meta">{movie.genre} · {movie.year}{watchedDates?.get(movie.id) ? ` · ${formatWatchDate(watchedDates.get(movie.id))}` : ""}</div>
                </div>
                <PosterRatingDot rating={r} size={36} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const INSIGHT_TYPES = ["movie_twin", "vibe_check", "blind_spot", "taste_evolution", "movie_dna"];

const INSIGHT_LABELS = {
  movie_twin: "Movie Twin",
  vibe_check: "Vibe Check",
  blind_spot: "Blind Spot",
  taste_evolution: "Taste Evolution",
  movie_dna: "Movie DNA",
};

const INSIGHT_ICONS = {
  movie_twin: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  vibe_check: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
    </svg>
  ),
  blind_spot: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ),
  taste_evolution: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  movie_dna: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v20M2 12h20M12 2a10 10 0 0 1 10 10M12 2a10 10 0 0 0-10 10M12 22a10 10 0 0 1-10-10M12 22a10 10 0 0 0 10-10"/>
    </svg>
  ),
};

const FALLBACK_INSIGHTS = [
  { type: "vibe_check", text: "The Late-Night Rabbit Hole Diver -- you never watch just one." },
  { type: "movie_twin", text: "You watch like someone who grew up rewinding VHS tapes and never stopped chasing that feeling." },
  { type: "blind_spot", text: "Your watchlist is suspiciously low on foreign cinema. There's a whole world out there." },
  { type: "taste_evolution", text: "Your taste is quietly maturing -- fewer explosions, more conversations." },
  { type: "movie_dna", text: "Heavy on drama, generous with your ratings, and you've seen more movies this month than most people see in a year." },
  { type: "vibe_check", text: "The Curated Minimalist -- every pick is deliberate, nothing is filler." },
  { type: "movie_twin", text: "You've got Villeneuve energy -- patient, atmospheric, always chasing the bigger picture." },
  { type: "blind_spot", text: "When's the last time you watched something made before 1990? Just asking." },
];

const INSIGHT_PROMPTS = {
  movie_twin: 'Compare the user\'s taste to a famous director or filmmaker in exactly ONE sentence. Format: "You watch like [Director] -- [2-3 word description of shared quality]." Be specific and witty. No quotes around the director name.',
  vibe_check: 'Give the user a fun, specific personality label based on their movie taste in exactly ONE sentence. Format: "The [Creative Label] -- [one short explanatory clause]." Make it feel like a horoscope for movie lovers. Be playful.',
  blind_spot: 'Identify ONE genre, decade, or type of film conspicuously absent from their list in exactly ONE sentence. Be direct and a little teasing. Example tone: "You\'ve never touched a documentary" or "The 70s called, they want you to visit."',
  taste_evolution: 'Describe how their taste appears to be shifting in exactly ONE sentence based on any pattern you see (early vs recent entries, rating patterns). Format: "You started [X] but you\'re drifting into [Y]." If no clear shift, note what stays constant.',
  movie_dna: 'Summarize their movie DNA in exactly ONE line: top genre + average rating tendency + one fun stat or observation. Keep it punchy like a dating profile bio for their taste.',
};


const AI_INSIGHTS_ENABLED = false;

function JournalTab({ watchedMovies, watchedNotes, setWatchedNote, watchedIds, toggleWatched, savedIds, toggleSave, watchedRatings, setWatchedRating, watchedDates, tasteProfile, onSetTasteProfile, startDebrief, unlockedBadges, collections, scrollPositions, chats }) {
  const { user, getAccessToken } = useAuth();
  const [selectedMovie, setSelectedMovie] = useMovieModal();
  const [view, _setView] = useState("journal");
  const prevViewRef = useRef("journal");
  const [viewDir, setViewDir] = useState(null);
  const [viewFading, setViewFading] = useState(false);
  const viewFadeTimer = useRef(null);
  const journalContentRef = useRef(null);
  const subScrollPositions = useRef({});
  const setView = useCallback((v) => {
    if (v === prevViewRef.current) return;
    // Save current sub-tab scroll
    if (journalContentRef.current) {
      subScrollPositions.current[prevViewRef.current] = journalContentRef.current.scrollTop;
    }
    if (viewFadeTimer.current) clearTimeout(viewFadeTimer.current);
    setViewFading(true);
    viewFadeTimer.current = setTimeout(() => {
      setViewDir("fade-in");
      prevViewRef.current = v;
      _setView(v);
      setViewFading(false);
    }, 150);
  }, []);
  const [journalSearch, setJournalSearch] = useState("");
  const [journalSort, setJournalSort] = useState(() => {
    const stored = loadFromStorage("cc_journalSort", "date_desc");
    return JOURNAL_SORT_OPTIONS.some((o) => o.value === stored) ? stored : "date_desc";
  });
  const [runtimeCache, setRuntimeCache] = useState(() => loadFromStorage("cc_runtimeCache", {}));
  const [insightLoading, setInsightLoading] = useState(false);
  const [insight, setInsight] = useState(() =>
    AI_INSIGHTS_ENABLED ? null : { type: "movie_twin", text: "You watch like Christopher Nolan — big ideas wrapped in blockbuster packaging." }
  );
  const [emptyJournal] = useState(() => pickRandom(EMPTY_JOURNAL));
  const [emptyRankings] = useState(() => pickRandom(EMPTY_RANKINGS));
  const [emptyStats] = useState(() => pickRandom(EMPTY_STATS));

  // Sync sort preferences from Supabase on login
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    preferencesService.getPreferences(user.id).then((prefs) => {
      if (cancelled) return;
      const t = prefs.ui_toggles;
      if (t?.journalSort && JOURNAL_SORT_OPTIONS.some((o) => o.value === t.journalSort)) setJournalSort(t.journalSort);
    });
    return () => { cancelled = true; };
  }, [user]);

  // Restore sub-tab scroll after view switch (skip initial mount — handled by main tab restore)
  const viewMounted = useRef(false);
  useEffect(() => {
    if (!viewMounted.current) { viewMounted.current = true; return; }
    const el = journalContentRef.current;
    let raf;
    if (el) {
      raf = requestAnimationFrame(() => { el.scrollTop = subScrollPositions.current[view] || 0; });
    }
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [view]);

  // Save/restore main tab scroll position (runs on mount/unmount)
  useEffect(() => {
    const el = journalContentRef.current;
    if (el && scrollPositions.current["journal"]) {
      el.scrollTop = scrollPositions.current["journal"];
    }
    return () => {
      if (el) scrollPositions.current["journal"] = el.scrollTop;
    };
  }, [scrollPositions]);

  const movies = useMemo(
    () => Array.from(watchedMovies.values()).map((m, i) => ({ ...m, _idx: i })),
    [watchedMovies]
  );

  const handleToggleWatched = (movie) => {
    toggleWatched(movie);
    setSelectedMovie(null);
  };

  // AI Insight Card — fetch a fresh insight
  const fetchInsight = useCallback(async () => {
    if (!AI_INSIGHTS_ENABLED) return;
    if (movies.length < 3) return;
    const insightType = INSIGHT_TYPES[Math.floor(Math.random() * INSIGHT_TYPES.length)];
    setInsightLoading(true);
    try {
      const recent = movies.slice(-20);
      const lines = recent.map((m) => {
        const score = watchedRatings.get(m.id);
        return `${m.title} (${m.genre}, ${m.year})${score ? ` — rated ${score}/100` : ""}`;
      });
      const systemPrompt = `You are a witty, concise movie taste analyst. The user has watched these movies: ${lines.join("; ")}. Respond with ONLY the insight text, nothing else. No preamble, no "Here's your insight", just the insight itself. Max 2 sentences.`;
      const userPrompt = INSIGHT_PROMPTS[insightType];
      const token = getAccessToken();
      if (!token) return;
      const resp = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 120, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      const text = data.content?.[0]?.text?.trim();
      if (text) {
        const result = { type: insightType, text, ts: Date.now() };
        saveToStorage("cc_aiInsight", result);
        setInsight({ type: insightType, text });
        onSetTasteProfile(text);
        setTimeout(() => AOS.refresh(), 50);
      } else {
        throw new Error("Empty response");
      }
    } catch {
      const fb = FALLBACK_INSIGHTS[Math.floor(Math.random() * FALLBACK_INSIGHTS.length)];
      setInsight({ type: fb.type, text: fb.text });
    } finally {
      setInsightLoading(false);
    }
  }, [movies, watchedRatings, onSetTasteProfile]);

  const refreshInsight = useCallback(() => {
    removeFromStorage("cc_aiInsight");
    setInsight(null);
    fetchInsight();
  }, [fetchInsight]);

  // Auto-fetch on mount — always fresh
  useEffect(() => {
    if (movies.length < 3) return;
    fetchInsight();
  }, [movies.length >= 3 ? "ready" : "waiting"]);

  // Persist sort preferences
  useEffect(() => {
    saveToStorage("cc_journalSort", journalSort);
    if (user) preferencesService.updateUIToggles(user.id, { journalSort }).catch(syncFailToast);
  }, [journalSort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveToStorage("cc_runtimeCache", runtimeCache); }, [runtimeCache]);

  // Fetch runtimes when runtime sort is active
  const runtimeFetchedRef = useRef(false);
  useEffect(() => {
    const needsRuntime = journalSort === "runtime_desc";
    if (!needsRuntime || movies.length === 0) return;
    const missing = movies.filter((m) => !(m.id in runtimeCache));
    if (missing.length === 0 || runtimeFetchedRef.current) return;
    runtimeFetchedRef.current = true;
    let cancelled = false;
    (async () => {
      const batch = {};
      for (const m of missing) {
        try {
          const details = await getMovieDetails(m.id);
          if (cancelled) return;
          if (details?.runtime) batch[m.id] = details.runtime;
        } catch {}
      }
      if (!cancelled && Object.keys(batch).length > 0) {
        setRuntimeCache((prev) => ({ ...prev, ...batch }));
      }
    })();
    return () => { cancelled = true; };
  }, [journalSort, movies, runtimeCache]);

  // Reset fetch guard when sort changes away from runtime
  useEffect(() => {
    if (journalSort !== "runtime_desc") runtimeFetchedRef.current = false;
  }, [journalSort]);

  // Sort helper
  const sortMovies = useCallback((list, sortKey) => {
    const sorted = [...list];
    switch (sortKey) {
      case "rating_desc":
        return sorted.sort((a, b) => (watchedRatings.get(b.id) ?? -1) - (watchedRatings.get(a.id) ?? -1));
      case "tmdb_desc":
        return sorted.sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0));
      case "tmdb_asc":
        return sorted.sort((a, b) => parseFloat(a.rating || 0) - parseFloat(b.rating || 0));
      case "year_desc":
        return sorted.sort((a, b) => (b.year || "").localeCompare(a.year || ""));
      case "year_asc":
        return sorted.sort((a, b) => (a.year || "").localeCompare(b.year || ""));
      case "date_desc":
        return sorted.sort((a, b) => (watchedDates?.get(b.id) || "").localeCompare(watchedDates?.get(a.id) || ""));
      case "date_asc":
        return sorted.sort((a, b) => (watchedDates?.get(a.id) || "").localeCompare(watchedDates?.get(b.id) || ""));
      case "runtime_desc":
        return sorted.sort((a, b) => (runtimeCache[b.id] || 0) - (runtimeCache[a.id] || 0));
      case "alpha_asc":
        return sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      case "genre_group":
        return sorted.sort((a, b) => (a.genre || "").localeCompare(b.genre || "") || (a.title || "").localeCompare(b.title || ""));
      default:
        return sorted;
    }
  }, [watchedRatings, watchedDates, runtimeCache]);

  // Sorted lists
  const sortedJournalMovies = useMemo(
    () => sortMovies(movies, journalSort),
    [movies, journalSort, sortMovies]
  );

  const filteredJournalMovies = useMemo(() => {
    if (!journalSearch.trim()) return sortedJournalMovies;
    const q = journalSearch.trim().toLowerCase();
    return sortedJournalMovies.filter((m) => (m.title || "").toLowerCase().includes(q));
  }, [sortedJournalMovies, journalSearch]);

  // For "Your rankings" sort: only movies with a personal rating count toward the podium/list.
  // Rated movies are sorted desc by rating in sortMovies("rating_desc").
  const ratedRanked = useMemo(
    () => filteredJournalMovies.filter((m) => watchedRatings.has(m.id)),
    [filteredJournalMovies, watchedRatings]
  );

  // Editorial-header stat strip — derived from the same filtered list.
  const journalStats = useMemo(() => {
    const totalMinutes = filteredJournalMovies.reduce(
      (sum, m) => sum + (runtimeCache[m.id] || 0), 0
    );
    const hours = totalMinutes > 0 ? Math.floor(totalMinutes / 60) : null;

    const ratings = filteredJournalMovies
      .map((m) => watchedRatings?.get(m.id))
      .filter((r) => typeof r === "number");
    const avg = ratings.length > 0
      ? (ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)
      : null;
    const highest = ratings.length > 0 ? Math.max(...ratings) : null;

    const genreCounts = {};
    filteredJournalMovies.forEach((m) => {
      if (m.genre) genreCounts[m.genre] = (genreCounts[m.genre] || 0) + 1;
    });
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return { count: filteredJournalMovies.length, hours, avg, topGenre, highest };
  }, [filteredJournalMovies, runtimeCache, watchedRatings]);

  const TOGGLE_VIEWS = ["journal", "stats"];
  const toggleIndex = TOGGLE_VIEWS.indexOf(view);

  return (
    <>
      <div className="content journal-content" ref={journalContentRef}>
        <div className={`journal-view-panel ${viewFading ? "tab-fade-out" : ""} ${viewDir === "fade-in" ? "tab-fade-in" : ""}`} key={view}>

        {movies.length === 0 && (
          <div className="saved-empty">
            {view === "journal" && (
              <>
                <div className="saved-icon">{emptyJournal.icon}</div>
                <div className="saved-title">{emptyJournal.title}</div>
                <div className="saved-desc">{emptyJournal.desc}</div>
              </>
            )}
            {view === "stats" && (
              <>
                <div className="saved-icon">{emptyStats.icon}</div>
                <div className="saved-title">{emptyStats.title}</div>
                <div className="saved-desc">{emptyStats.desc}</div>
              </>
            )}
          </div>
        )}

        {movies.length > 0 && (
          <>
            {view === "journal" && (
              <>
                {/* Editorial header: eyebrow → headline → stat strip → controls row */}
                <div className="journal-editorial-header" data-aos="fade-right" data-aos-duration="300">
                  <div className="je-eyebrow-row">
                    <div className="je-eyebrow-block" />
                    <div className="je-eyebrow-text">YOUR JOURNAL · THE ARCHIVE</div>
                  </div>
                  <h1 className="je-headline">
                    {filteredJournalMovies.length} films logged — here&apos;s the{" "}
                    <span className="journal-headline-accent">shape of you</span>.
                  </h1>
                  <div className="je-stat-strip">
                    <div className="je-stat">
                      <div className="je-stat-num">{journalStats.count}</div>
                      <div className="je-stat-label">FILMS LOGGED</div>
                    </div>
                    <div className="je-stat">
                      <div className="je-stat-num">{journalStats.hours ?? "—"}</div>
                      <div className="je-stat-label">HOURS</div>
                    </div>
                    <div className="je-stat">
                      <div className="je-stat-num">{journalStats.avg ?? "—"}</div>
                      <div className="je-stat-label">AVG</div>
                    </div>
                    <div className="je-stat je-stat-hide-mobile">
                      <div className="je-stat-num">{journalStats.topGenre ?? "—"}</div>
                      <div className="je-stat-label">TOP GENRE</div>
                    </div>
                    <div className="je-stat je-stat-hide-mobile">
                      <div className="je-stat-num je-stat-num-accent">{journalStats.highest ?? "—"}</div>
                      <div className="je-stat-label">HIGHEST</div>
                    </div>
                  </div>
                  <div className="je-controls-row">
                    <div className="je-search">
                      <span className="search-icon"><SearchIcon /></span>
                      <input
                        type="text"
                        placeholder="Search movies..."
                        value={journalSearch}
                        onChange={(e) => setJournalSearch(e.target.value)}
                      />
                      {journalSearch && (
                        <button className="search-clear" onClick={() => setJournalSearch("")}>✕</button>
                      )}
                    </div>
                    <SortDropdown options={JOURNAL_SORT_OPTIONS} value={journalSort} onChange={setJournalSort} />
                    <div className="je-view-toggle">
                      <button
                        className={`je-view-toggle-btn ${view === "journal" ? "active" : ""}`}
                        onClick={() => setView("journal")}
                        type="button"
                      >Journal</button>
                      <button
                        className={`je-view-toggle-btn ${view === "stats" ? "active" : ""}`}
                        onClick={() => setView("stats")}
                        type="button"
                      >Stats</button>
                    </div>
                  </div>
                </div>

                {filteredJournalMovies.length === 0 && journalSearch.trim() ? (
                  <div className="journal-no-results">No movies found</div>
                ) : journalSort === "rating_desc" ? (
                  /* "Your rankings" — hero #1 + podium #2/#3 + numbered list */
                  ratedRanked.length === 0 ? (
                    <div className="rankings-empty">Rate movies to build your rankings.</div>
                  ) : (
                    <RankingsLayout
                      ranked={ratedRanked}
                      watchedRatings={watchedRatings}
                      watchedDates={watchedDates}
                      onOpen={setSelectedMovie}
                    />
                  )
                ) : journalSort === "genre_group" ? (
                  (() => {
                    const groups = {};
                    filteredJournalMovies.forEach((m) => {
                      const g = m.genre || "Other";
                      if (!groups[g]) groups[g] = [];
                      groups[g].push(m);
                    });
                    return Object.entries(groups).map(([genre, gMovies]) => (
                      <div key={genre} className="journal-genre-group">
                        <div className="journal-genre-header" style={{ color: GENRE_COLORS[genre] || "var(--text-secondary)" }}>{genre}</div>
                        <div className="jp-grid">
                          {gMovies.map((movie) => (
                            <JournalPosterCard
                              key={movie.id}
                              movie={movie}
                              rating={watchedRatings?.get(movie.id)}
                              onClick={() => setSelectedMovie(movie)}
                            />
                          ))}
                        </div>
                      </div>
                    ));
                  })()
                ) : (
                  /* Default poster wall: month-grouped when sorted by date, otherwise flat */
                  (journalSort === "date_desc" || journalSort === "date_asc") ? (
                    groupByMonth(filteredJournalMovies, watchedDates).map((g) => (
                      <div key={g.key} className="jp-month-group">
                        <div className="browse-section-header browse-section-header-v2">
                          <div className="browse-section-titles">
                            <div className="browse-section-eyebrow">— {g.eyebrow} —</div>
                            <div className="browse-section-title">{g.label}</div>
                          </div>
                        </div>
                        <div className="jp-grid">
                          {g.movies.map((movie) => (
                            <JournalPosterCard
                              key={movie.id}
                              movie={movie}
                              rating={watchedRatings?.get(movie.id)}
                              onClick={() => setSelectedMovie(movie)}
                            />
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="jp-grid">
                      {filteredJournalMovies.map((movie) => (
                        <JournalPosterCard
                          key={movie.id}
                          movie={movie}
                          rating={watchedRatings?.get(movie.id)}
                          onClick={() => setSelectedMovie(movie)}
                        />
                      ))}
                    </div>
                  )
                )}
              </>
            )}

            {view === "stats" && (
              <StatsView watchedMovies={watchedMovies} watchedRatings={watchedRatings} watchedDates={watchedDates} collections={collections} chats={chats} />
            )}
          </>
        )}
        </div>
      </div>

      {/* Floating Toggle Pill — portaled to body. Only shown in Stats view since the
          Journal view's editorial header has its own inline segmented toggle. */}
      {view === "stats" && createPortal(
        <div className="journal-float-toggle">
          <div className="journal-float-toggle-track" style={{ transform: `translateX(${toggleIndex * 100}%)` }} />
          <button className={`journal-float-toggle-btn ${view === "journal" ? "active" : ""}`} onClick={() => setView("journal")}>Journal</button>
          <button className={`journal-float-toggle-btn ${view === "stats" ? "active" : ""}`} onClick={() => setView("stats")}>Stats</button>
        </div>,
        document.body
      )}

      {selectedMovie && (
        <JournalDetailModal
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          note={watchedNotes.get(selectedMovie.id) || ""}
          onSaveNote={setWatchedNote}
          isSaved={savedIds.has(selectedMovie.id)}
          onToggleSave={toggleSave}
          onToggleWatched={handleToggleWatched}
          rating={watchedRatings.get(selectedMovie.id) ?? null}
          onSetRating={setWatchedRating}
          onStartDebrief={startDebrief}
        />
      )}
    </>
  );
}

// ─── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab({ chats, activeChatId, setActiveChatId, onCreateChat, onDeleteChat, onRenameChat, onSaveMessage, tasteProfile, debriefPayload, onDebriefHandled }) {
  const { user, getAccessToken } = useAuth();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [typingHint, setTypingHint] = useState(null);
  const [researching, setResearching] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [smartMode, setSmartMode] = useState(() => {
    return loadFromStorage("cinno-smart-mode", false);
  });
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const debriefHandledRef = useRef(null);

  // Sync smartMode from Supabase on login
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    preferencesService.getPreferences(user.id).then((prefs) => {
      if (cancelled) return;
      const remote = prefs.ui_toggles?.smartMode;
      if (remote !== undefined) {
        setSmartMode(remote);
        saveToStorage("cinno-smart-mode", remote);
      }
    });
    return () => { cancelled = true; };
  }, [user]);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat ? activeChat.messages : [];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollBtn(distFromBottom > 120);
  }, []);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }
  };

  const toggleSmartMode = () => {
    setSmartMode((prev) => {
      const next = !prev;
      saveToStorage("cinno-smart-mode", next);
      if (user) preferencesService.updateUIToggles(user.id, { smartMode: next }).catch(syncFailToast);
      return next;
    });
  };

  const fetchSmartEnrichment = async (userMsg) => {
    let tmdbContext = "";
    let webContext = "";

    try {
      const smartData = await getSmartContext(userMsg);
      if (smartData?.found) {
        tmdbContext = smartData.context;

        try {
          const searchQuery = `${smartData.title} ${smartData.year} movie reviews opinions discussion`;
          const searchToken = getAccessToken();
          const resp = searchToken ? await fetch(`${API_URL}/api/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${searchToken}` },
            body: JSON.stringify({ query: searchQuery }),
          }) : null;
          if (resp && resp.ok) {
            const data = await resp.json();
            const snippets = (data.results || []).slice(0, 3).map((r) => r.content?.slice(0, 200) || "").filter(Boolean);
            webContext = data.answer
              ? `Web context: ${data.answer}${snippets.length ? `. Sources: ${snippets.join(" | ")}` : ""}`
              : snippets.length ? `Web context: ${snippets.join(" | ")}` : "";
          }
        } catch { /* Tavily unavailable, continue without web context */ }
      }
    } catch { /* TMDB enrichment failed, continue without it */ }

    return [tmdbContext, webContext].filter(Boolean).join("\n\n");
  };

  const createNewChat = async () => {
    const newId = await onCreateChat();
    setActiveChatId(newId);
    setSidebarOpen(false);
  };

  const selectChat = (id) => { setActiveChatId(id); setSidebarOpen(false); };

  const deleteChat = async (id) => {
    const remaining = chats.filter((c) => c.id !== id);
    if (id === activeChatId) {
      if (remaining.length > 0) {
        setActiveChatId(remaining[0].id);
      } else {
        const newId = await onCreateChat();
        setActiveChatId(newId);
      }
    }
    onDeleteChat(id);
  };

  const startRename = (e, id, currentTitle) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      onRenameChat(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const generateTitle = async (chatId, userMsg, assistantMsg) => {
    try {
      const titleToken = getAccessToken();
      if (!titleToken) return;
      const resp = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${titleToken}` },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 30,
          messages: [{ role: "user", content: `Generate a very short chat title (max 5 words, no quotes, no punctuation at end) that summarizes this movie conversation:\n\nUser: ${userMsg}\nAssistant: ${assistantMsg.slice(0, 200)}` }],
        }),
      });
      const data = await resp.json();
      const title = data.content?.[0]?.text?.trim();
      if (title) onRenameChat(chatId, title);
    } catch {
      const fallback = userMsg.length > 28 ? userMsg.slice(0, 28) + "…" : userMsg;
      onRenameChat(chatId, fallback);
    }
  };

  const [suggestions] = useState(() => [...ALL_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4));
  const [pickerHints] = useState(() => [...PICKER_SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4));

  // Follow-up chips: pick a random set each time assistant replies
  const followupChips = useMemo(() => {
    if (loading || messages.length === 0 || input.trim()) return null;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role !== "assistant") return null;
    const pool = activeChat?.movieContext ? DEBRIEF_FOLLOWUPS : GENERAL_FOLLOWUPS;
    return pool[messages.length % pool.length];
  }, [messages, loading, input, activeChat?.movieContext]);

  // Timestamp formatting
  const formatTimestamp = useCallback((ts) => formatChatTimestamp(ts), []);

  // Decide whether to show a timestamp before message index i
  const shouldShowTimestamp = useCallback((msgs, i) => {
    const msg = msgs[i];
    if (!msg?.ts) return false;
    if (i === 0) return true;
    const prev = msgs[i - 1];
    if (!prev?.ts) return true;
    // Show if more than 2 minutes gap
    return (msg.ts - prev.ts) > 120000;
  }, []);

  const sendMessage = async (text) => {
    const userMsg = sanitizeText(text || input.trim()).slice(0, 2000);
    if (!userMsg || loading) return;

    const chatId = activeChatId;
    setInput("");
    setError("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    // Build the messages array locally for the API call
    const userMessageObj = { role: "user", content: userMsg, ts: Date.now() };
    const newMessages = [...messages, userMessageObj];

    // Optimistic: show user message immediately + persist to Supabase in background
    onSaveMessage(chatId, "user", userMsg);

    const isFirstMessage = messages.length === 0;
    const TYPING_HINTS = [
      "Replaying that moment...", "Thinking about that scene...", "Processing your take...",
      "That soundtrack though...", "Picturing the cinematography...", "Rewinding to that part...",
      "Sitting with that ending...",
    ];
    setTypingHint(Math.random() < 0.4 ? TYPING_HINTS[Math.floor(Math.random() * TYPING_HINTS.length)] : null);
    setLoading(true);

    try {
      let smartEnrichment = "";
      if (smartMode && !activeChat?.pickerMode) {
        setResearching(true);
        try {
          smartEnrichment = await fetchSmartEnrichment(userMsg);
        } catch { /* continue without enrichment */ }
        setResearching(false);
      }

      let movieContext;
      const picker = activeChat?.pickerMode;
      const pc = activeChat?.pickerContext;

      const basePrompt = `You're a movie-obsessed friend. Not a service, not an assistant — a friend who watches way too many movies.

Rules:
- Match the user's energy. If they write one line, you respond with one line. If they want depth, go deep.
- For recommendations: just give them. Don't ask clarifying questions unless the user is extremely vague like 'recommend me something' with zero context. If they give you ANY hint (genre, mood, a movie they liked), skip the questions and go straight to recommendations.
- Never repeat back what the user just said. Don't say 'So you want sci-fi...' or 'Great choice!' Just respond naturally.
- Never ask more than 1 question per message. If you need to ask, make it casual and quick, not a structured interview.
- Keep recommendations tight: movie name, year, one sentence why. No bullet points, no numbered lists.
- For explanations, plot discussions, or debriefs: go longer and more thoughtful. Match the depth of what they're asking.
- Be opinionated. Have actual takes. Disagree sometimes. A real friend doesn't just validate everything.
- No emojis, no markdown bold, no headers, no bullet points ever. Just natural conversation.
- No phrases like 'Great question!' or 'That's a great pick!' or 'I'd love to help!' — these sound like customer service.
- Swear very occasionally if it fits the vibe, but don't force it.
- If the user's journal or watchlist data is available, reference it naturally like a friend who knows their taste. Don't announce that you're doing it.`;

      if (picker) {
        movieContext = `${basePrompt}

The user is using the movie picker — they want to decide what to watch right now. Get to recommendations fast.${pc?.watched ? `\n\nMovies they've watched recently: ${pc.watched}` : ""}${pc?.watchlist ? `\n\nMovies on their watchlist (haven't watched yet): ${pc.watchlist}` : ""}${pc?.tasteProfile ? `\n\nTheir taste profile: ${pc.tasteProfile}` : ""}`;
      } else {
        const personalContext = tasteProfile ? `The user's taste profile: ${tasteProfile}` : "";
        const mc = activeChat?.movieContext;
        const debriefContext = mc ? `\n\nThe user is debriefing about "${mc.title}" (${mc.year}, ${mc.genre}). TMDB rating: ${mc.tmdbRating}/10. Synopsis: ${mc.synopsis}.` : "";
        movieContext = `${basePrompt}${smartEnrichment ? "\n\nYou have detailed movie data and web research below — use it to give informed, specific answers. Reference details naturally without dumping all the data." : ""}${debriefContext}${personalContext ? "\n\n" + personalContext : ""}${smartEnrichment ? "\n\n" + smartEnrichment : ""}`;
      }

      const chatToken = getAccessToken();
      if (!chatToken) {
        setLoading(false);
        return;
      }
      const resp = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${chatToken}` },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: movieContext,
          messages: newMessages.slice(-50).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (resp.status === 429) {
        setError("Slow down! Try again in a minute.");
        return;
      }
      if (resp.status === 503) {
        setError("Daily chat limit reached. Try again tomorrow.");
        return;
      }

      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || data.error.type || "API error");

      const assistantText = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "I couldn't generate a response. Please try again.";
      onSaveMessage(chatId, "assistant", assistantText);

      if (isFirstMessage && !activeChat?.movieContext && !activeChat?.pickerMode) generateTitle(chatId, userMsg, assistantText);
    } catch {
      setError("Chat is temporarily unavailable. Please try again in a moment.");
    } finally {
      setLoading(false);
      setResearching(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  useEffect(() => {
    if (debriefPayload && debriefPayload.chatId === activeChatId && debriefHandledRef.current !== debriefPayload.chatId) {
      debriefHandledRef.current = debriefPayload.chatId;
      sendMessage(debriefPayload.message);
      onDebriefHandled?.();
    }
  }, [debriefPayload, activeChatId]);

  return (
    <div className="chat-layout">
      {sidebarOpen && (
        <>
          <div className="chat-sidebar-overlay" onClick={() => setSidebarOpen(false)} />
          <div className="chat-sidebar">
            <div className="sidebar-header">
              <span className="sidebar-title">Chats</span>
              <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
            <button className="sidebar-new-btn" onClick={createNewChat}>+ New conversation</button>
            <div className="sidebar-list">
              {chats.map((chat) => (
                <div key={chat.id} className={`sidebar-item ${chat.id === activeChatId ? "active" : ""}`} onClick={() => renamingId !== chat.id && selectChat(chat.id)}>
                  {renamingId === chat.id ? (
                    <input
                      className="sidebar-rename-input"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="sidebar-item-label">{chat.title}</span>
                  )}
                  {renamingId !== chat.id && (
                    <>
                      <button className="sidebar-item-rename" onClick={(e) => startRename(e, chat.id, chat.title)}>✎</button>
                      {chats.length > 1 && (
                        <button className="sidebar-item-delete" onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}>✕</button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="chat-main">
        <div className="chat-topbar">
          <button className="chat-menu-btn" onClick={() => setSidebarOpen(true)}><MenuIcon /></button>
          <span className="chat-topbar-title">{activeChat?.title || "New chat"}</span>
          <button className={`smart-toggle ${smartMode ? "smart-toggle-on" : ""}`} onClick={toggleSmartMode} title="Smart Mode — enriches responses with TMDB data and web search">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z"/></svg>
            <span>Smart</span>
          </button>
          <button className="chat-topbar-new" onClick={createNewChat} title="New chat">+</button>
        </div>

        <div className="chat-messages-wrap">
          <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
            {messages.length === 0 && !loading ? (
              <div className="chat-welcome">
                <div className="chat-welcome-header">
                  <div className="chat-welcome-icon">
                    <CinnoLogo size={64} />
                  </div>
                  <h2>What are we watching?</h2>
                  <p>Your personal movie expert</p>
                </div>
                <div className="chat-suggestions-grid">
                  {suggestions.map((s) => (
                    <button key={s.text} className="chat-suggestion-card" onClick={() => sendMessage(s.text)}>
                      <span className="chat-suggestion-icon">
                        {s.icon === "knife" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14.5 2L6 14h3l-1.5 8L18 10h-3z"/></svg>}
                        {s.icon === "brain" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 3c-1 3-1 6 0 9s-1 6 0 9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/></svg>}
                        {s.icon === "film" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20M2 16h20M6 4v4M6 16v4M18 4v4M18 16v4"/></svg>}
                        {s.icon === "clock" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
                        {s.icon === "gem" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 3h12l4 6-10 13L2 9z"/><path d="M2 9h20"/><path d="M12 22L6 9l6-6 6 6z"/></svg>}
                        {s.icon === "popcorn" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M7 22l-2-10h14l-2 10z"/><path d="M5 12a3 3 0 01-.5-5A3 3 0 018 4a3 3 0 014 0 3 3 0 013.5 3 3 3 0 01-.5 5"/></svg>}
                        {s.icon === "music" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>}
                        {s.icon === "masks" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>}
                        {s.icon === "globe" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>}
                        {s.icon === "people" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>}
                        {s.icon === "heart" && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>}
                      </span>
                      <span className="chat-suggestion-text">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <React.Fragment key={i}>
                    {shouldShowTimestamp(messages, i) && (
                      <div className="chat-timestamp">{formatTimestamp(msg.ts)}</div>
                    )}
                    <div className={`msg msg-${msg.role}`}>
                      <div className="msg-avatar">
                        {msg.role === "assistant" ? <BotIcon /> : <span className="msg-user-initial">N</span>}
                      </div>
                      <div className="msg-bubble">
                        {msg.content.split("\n").map((line, j) => (
                          <span key={j}>{line}{j < msg.content.split("\n").length - 1 && <br />}</span>
                        ))}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
                {loading && (
                  <div className="msg msg-assistant">
                    <div className="msg-avatar"><BotIcon /></div>
                    <div className="msg-bubble">
                      {researching && <div className="msg-researching">Researching...</div>}
                      <SkeletonChatBubbles />
                      <div className="msg-typing">
                        {typingHint && <em className="msg-typing-hint">{typingHint}</em>}
                        <span /><span /><span />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {error && <div className="chat-error">{error}</div>}
            <div ref={messagesEndRef} />
          </div>

          {showScrollBtn && (
            <button className="chat-scroll-bottom" onClick={scrollToBottom} title="Scroll to bottom">
              <ChevronDownIcon />
            </button>
          )}
        </div>

        <div className="chat-input-float">
          {followupChips && !input.trim() && (
            <div className="chat-followup-chips">
              {followupChips.map((chip) => (
                <button key={chip} className="chat-followup-chip" onClick={() => sendMessage(chip)}>{chip}</button>
              ))}
            </div>
          )}
          <div className="chat-input-pill">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any movie..."
              rows={1}
            />
            <button className="chat-send-pill" onClick={() => sendMessage()} disabled={!input.trim() || loading}>
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Modal ────────────────────────────────────────────────────────────

function MilestoneCelebration({ milestone, onDismiss }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!milestone) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#8B3A4A", "#A34A5A", "#C4A84E", "#D4B85E", "#F0EBE3", "#E8DDD0"];
    const particles = [];
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: -10 - Math.random() * canvas.height * 0.4,
        w: 3 + Math.random() * 5,
        h: 6 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 2,
        vy: 1.5 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2,
        rotV: (Math.random() - 0.5) * 0.12,
        opacity: 0.7 + Math.random() * 0.3,
      });
    }

    const start = performance.now();
    const duration = 3000;

    function draw(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const fade = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = fade;

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.04;
        p.rot += p.rotV;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity * fade;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });

      if (progress < 1) {
        animRef.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [milestone]);

  useEffect(() => {
    if (!milestone) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [milestone, onDismiss]);

  if (!milestone) return null;

  return createPortal(
    <div className="milestone-overlay" onClick={onDismiss}>
      <canvas ref={canvasRef} className="milestone-canvas" />
      <div className="milestone-card">
        <div className="milestone-label">Milestone!</div>
        <div className="milestone-number">{milestone}</div>
        <div className="milestone-message">
          {milestone} movies watched — {MILESTONE_MESSAGES[milestone]}
        </div>
      </div>
    </div>,
    document.body
  );
}

const JOURNAL_SORT_OPTIONS = [
  { value: "rating_desc", label: "Your rankings" },
  { value: "date_desc", label: "Date watched (recent)" },
  { value: "date_asc", label: "Date watched (oldest)" },
  { value: "tmdb_desc", label: "TMDB rating (high to low)" },
  { value: "year_desc", label: "Release year (newest)" },
  { value: "year_asc", label: "Release year (oldest)" },
  { value: "runtime_desc", label: "Runtime (longest)" },
  { value: "alpha_asc", label: "Alphabetical (A-Z)" },
  { value: "genre_group", label: "Genre (grouped)" },
];

function SortDropdown({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel = options.find((o) => o.value === value)?.label || "";

  return (
    <div className="sort-dropdown" ref={wrapRef}>
      <button className="sort-dropdown-btn" onClick={() => setOpen(!open)}>
        <span className="sort-dropdown-label">{activeLabel}</span>
        <svg className={`sort-dropdown-chevron${open ? " open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="sort-dropdown-menu">
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`sort-dropdown-item${opt.value === value ? " active" : ""}`}
              onClick={() => { onChange(opt.value); setOpen(false); }}
            >
              <span>{opt.label}</span>
              {opt.value === value && (
                <svg className="sort-dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsModal({ onClose, onClearData, theme, onToggleTheme }) {
  const { modalRef, overlayRef, animatedClose, swipeHandlers } = useSwipeToDismiss(onClose);

  return (
    <div className="movie-modal-overlay" ref={overlayRef} onClick={animatedClose}>
      <div className="movie-modal settings-modal" ref={modalRef} {...swipeHandlers} onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="settings-header">
          <div className="settings-title">Settings</div>
          <button className="modal-close-btn" style={{ position: "static" }} onClick={animatedClose}>✕</button>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <div>
              <div className="settings-label">Theme</div>
              <div className="settings-desc">{theme === "dark" ? "Dark mode" : "Light mode"}</div>
            </div>
            <button className="settings-toggle" onClick={onToggleTheme}>
              <div className={`settings-toggle-track ${theme === "light" ? "active" : ""}`}>
                <div className="settings-toggle-thumb" />
              </div>
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <div>
              <div className="settings-label">Clear all data</div>
              <div className="settings-desc">Remove all saved movies, journal entries and chats</div>
            </div>
            <button className="settings-clear-btn" onClick={onClearData}>
              Clear
            </button>
          </div>
        </div>

        <div className="settings-version">Cinno v0.1</div>
      </div>
    </div>
  );
}

// ─── Discover Tab (Tinder-style swiping) ────────────────────────────────────────

const GENRE_ID_TO_LABEL = {};
GENRE_FILTERS.forEach((g) => { GENRE_ID_TO_LABEL[g.id] = g.label; });

// Map a movie's genre_ids → { genreName: weight } for swipe_history.genre_scores.
// liked = strong positive, disliked = strong negative, skipped (Later) = mild positive.
function computeGenreScores(movie, action) {
  if (!movie?.genre_ids || movie.genre_ids.length === 0) return null;
  const weight = action === "liked" ? 1 : action === "disliked" ? -1 :
                 action === "skipped" ? 0.25 : 0;
  if (weight === 0) return null;
  const scores = {};
  for (const genreId of movie.genre_ids) {
    const genreName = GENRE_MAP[genreId];
    if (genreName) scores[genreName] = weight;
  }
  return Object.keys(scores).length > 0 ? scores : null;
}

function DiscoverTab({ savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, collections, toggleMovieInCollection, setWatchedRating, watchedRatings, watchedMovies, isGuest, guardAction }) {
  const { user } = useAuth();
  const SESSION_LIMIT = 30;

  // ─── STEP 1: STATE ───
  const [movies, setMovies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swipeCount, setSwipeCount] = useState(0);
  const [swipeDir, setSwipeDir] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [selectedMovie, setSelectedMovie] = useMovieModal();
  const [undoHistory, setUndoHistory] = useState([]);
  const [showStamp, setShowStamp] = useState(null);
  const [cardDetails, setCardDetails] = useState({});
  const [activeGenres, setActiveGenres] = useState(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const discoverGenreFloating = useFloating({
    open: filterOpen,
    placement: "bottom-start",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const [maybeLater, setMaybeLater] = useState(() => loadFromStorage("cc_discover_maybe_later", []));

  // Load discover state from Supabase on login (migrate localStorage first)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        // Migrate localStorage discover data to Supabase on first login
        const localMaybeLater = loadFromStorage("cc_discover_maybe_later", []);
        if (localMaybeLater.length > 0) {
          const migrated = await discoverService.migrateLocalDiscover(user.id, {
            maybeLater: localMaybeLater,
          });
          if (migrated) {
            removeFromStorage("cc_discover_maybe_later");
            removeFromStorage("cc_discover_swipe_weights");
            removeFromStorage("cc_discover_seen");
            removeFromStorage("cc_discover_swipe_history");
          }
        }

        // Load full discover state from Supabase
        const state = await discoverService.loadFullDiscoverState(user.id);
        if (cancelled) return;

        // Sync maybeLater: rebuild from Supabase skipped IDs merged with local movie data
        if (state.maybeLaterIds.size > 0) {
          setMaybeLater((prev) => {
            // Keep existing movie objects for IDs we have, add placeholders for new ones
            const existingMap = new Map(prev.map((m) => [m.id, m]));
            const merged = [];
            for (const tmdbId of state.maybeLaterIds) {
              if (existingMap.has(tmdbId)) {
                merged.push(existingMap.get(tmdbId));
              } else {
                merged.push({ id: tmdbId, title: "Unknown", addedAt: Date.now() });
              }
            }
            return merged;
          });
        }
      } catch (e) {
        console.error("Failed to load discover state from Supabase:", e);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  const [watchedModal, setWatchedModal] = useState(null);
  const [watchedSlider, setWatchedSlider] = useState(75);
  const [cardKey, setCardKey] = useState(0);
  const [counterBump, setCounterBump] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(false);
  const filterDropdownRef = useRef(null);
  const fetchVersionRef = useRef(0);
  const swipingRef = useRef(false);
  const activeGenresRef = useRef(activeGenres);
  activeGenresRef.current = activeGenres;

  // Exclusion set: movies already in watchlist or journal
  const exclusionSet = useMemo(() => {
    const ids = new Set();
    savedIds.forEach((id) => ids.add(id));
    watchedIds.forEach((id) => ids.add(id));
    return ids;
  }, [savedIds, watchedIds]);

  // Compute preferred release date filter from journal decade preferences
  const releaseDateGte = useMemo(() => {
    if (!watchedMovies || watchedMovies.size === 0) return "2000-01-01";
    const decadeCounts = {};
    watchedMovies.forEach((m) => {
      const yr = parseInt(m.year);
      if (!yr || isNaN(yr)) return;
      const decade = Math.floor(yr / 10) * 10;
      decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
    });
    const entries = Object.entries(decadeCounts);
    if (entries.length === 0) return "2000-01-01";
    entries.sort((a, b) => b[1] - a[1]);
    const topDecade = parseInt(entries[0][0]);
    // 5-year buffer below preferred decade
    return `${topDecade - 5}-01-01`;
  }, [watchedMovies]);

  // Persist maybeLater
  useEffect(() => {
    saveToStorage("cc_discover_maybe_later", maybeLater);
    if (user) preferencesService.updateGenrePreferences(user.id, { discoverMaybeLater: maybeLater }).catch(syncFailToast);
  }, [maybeLater]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close genre dropdown on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target))
        setFilterOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [filterOpen]);

  // ─── FETCH LOGIC: ONE function for all fetch paths ───

  const loadMoviesRef = useRef(null);

  const loadRecommendedMovies = async () => {
    if (!user || isGuest) return null;
    try {
      const recs = await discoverService.fetchRecommendations(user.id);
      if (!recs || recs.length === 0) return null;

      // Build movies directly from cached rec fields — no per-movie TMDB call.
      // Tagline fetch for the first 4 cards happens in loadMovies, same as the TMDB path.
      const results = recs
        .filter((rec) => !exclusionSet.has(rec.tmdb_id) && rec.poster_path)
        .slice(0, 50)
        .map((rec) => {
          const movie = tmdbToMovie({
            id: rec.tmdb_id,
            title: rec.title,
            poster_path: rec.poster_path,
            backdrop_path: rec.backdrop_path,
            genre_ids: rec.genre_ids ?? [],
            release_date: rec.release_date,
            vote_average: rec.vote_average,
            overview: rec.overview,
          });
          // Attach recommendation reason for potential future UI use
          movie._reason = rec.reason;
          movie._score = rec.score;
          return movie;
        });

      if (results.length === 0) return null;

      // Sort by score descending, then shuffle top half slightly for variety
      results.sort((a, b) => (b._score || 0) - (a._score || 0));
      const topHalf = results.slice(0, Math.ceil(results.length / 2));
      const bottomHalf = results.slice(Math.ceil(results.length / 2));
      topHalf.sort(() => Math.random() - 0.5);
      const shuffled = [...topHalf, ...bottomHalf];

      return shuffled.slice(0, SESSION_LIMIT);
    } catch (e) {
      console.warn("[discover] Failed to load recommendations:", e);
      return null;
    }
  };

  const loadMovies = async (genreIds = [], append = false) => {
    const version = ++fetchVersionRef.current;

    if (!append) {
      setLoading(true);
      setSwipeCount(0);
      setUndoHistory([]);
    }

    try {
      // Try recommendations first (logged-in users only, no genre filter active)
      if (!append && user && !isGuest && genreIds.length === 0) {
        const recommended = await loadRecommendedMovies();
        if (recommended && recommended.length >= 5) {
          if (fetchVersionRef.current === version) {
            setMovies(recommended);
            setCurrentIndex(0);
            recommended.slice(0, 4).forEach((m) => {
              getMovieDetails(m.id).then((d) => {
                setCardDetails((prev) => ({
                  ...prev,
                  [m.id]: { tagline: d.tagline || "" }
                }));
              }).catch(() => {});
            });
            setLoading(false);
            return recommended.length;
          }
        }
      }
      // Fall through to existing TMDB fetch if recommendations unavailable
      // (guest user, genre filter active, not enough recommendations, or fetch failed)

      const discoverParams = {
        "vote_average.gte": "6.5",
        "vote_count.gte": "100",
        with_original_language: "en",
        sort_by: "popularity.desc",
        "primary_release_date.gte": releaseDateGte,
      };
      if (genreIds.length > 0) {
        discoverParams.with_genres = genreIds.join("|");
      }

      // Probe page 1 first to discover total_pages, so we don't request beyond available range
      let maxPage = 500; // TMDB hard cap
      try {
        const probe = await discoverMoviesRaw(discoverParams, 1);
        maxPage = Math.min(probe.totalPages || 1, 500);
      } catch {
        // fallback to default maxPage
      }

      const genreIdSet = new Set(genreIds);
      for (let attempt = 0; attempt < 3; attempt++) {
        // Pick a random page within the actual available range (leave room for page+1 fetch)
        const pageLimit = Math.max(1, maxPage - 1);
        const page = Math.floor(Math.random() * pageLimit) + 1;
        try {
          const [data1, data2] = await Promise.all([
            discoverMoviesRaw(discoverParams, page),
            discoverMoviesRaw(discoverParams, page + 1),
          ]);
          const combined = [...data1.results, ...data2.results];
          const seenIds = new Set();
          const batch = combined
            .filter((m) => {
              if (!m.poster_path || seenIds.has(m.id) || exclusionSet.has(m.id)) return false;
              seenIds.add(m.id);
              return true;
            })
            .map((m) => {
              const movie = tmdbToMovie(m);
              if (genreIdSet.size > 0 && m.genre_ids?.length) {
                const matchedId = m.genre_ids.find((gid) => genreIdSet.has(gid));
                if (matchedId && GENRE_ID_TO_LABEL[matchedId]) {
                  movie.genre = GENRE_ID_TO_LABEL[matchedId];
                }
              }
              return movie;
            });


          if (batch.length > 0 && fetchVersionRef.current === version) {
            batch.sort(() => Math.random() - 0.5);
            const limited = batch.slice(0, SESSION_LIMIT);
            if (append) {
              setMovies((prev) => {
                const existingIds = new Set(prev.map((m) => m.id));
                return [...prev, ...limited.filter((m) => !existingIds.has(m.id))];
              });
            } else {
              setMovies(limited);
              setCurrentIndex(0);
            }
            limited.slice(0, 4).forEach((m) => {
              getMovieDetails(m.id).then((d) => {
                setCardDetails((prev) => ({ ...prev, [m.id]: { tagline: d.tagline || "" } }));
              }).catch(() => {});
            });
            return limited.length;
          }
        } catch {
          // retry next page
        }
      }

      if (fetchVersionRef.current === version && !append) {
        setMovies([]);
        setCurrentIndex(0);
      }
      return 0;
    } finally {
      if (fetchVersionRef.current === version && !append) {
        setLoading(false);
      }
    }
  };

  loadMoviesRef.current = loadMovies;

  // Initial fetch on mount
  const initialFetchDone = useRef(false);
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
    loadMoviesRef.current([...activeGenresRef.current]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch taglines for upcoming 3 cards
  const fetchedTaglines = useRef(new Set());
  useEffect(() => {
    [movies[currentIndex], movies[currentIndex + 1], movies[currentIndex + 2]].forEach((m) => {
      if (!m || fetchedTaglines.current.has(m.id)) return;
      fetchedTaglines.current.add(m.id);
      getMovieDetails(m.id).then((d) => {
        setCardDetails((prev) => ({ ...prev, [m.id]: { tagline: d.tagline || "" } }));
      }).catch(() => {});
    });
  }, [currentIndex, movies]);

  // Auto-fetch when running low (< 5 cards ahead)
  useEffect(() => {
    if (movies.length > 0 && movies.length - currentIndex < 5 && !loading && swipeCount < SESSION_LIMIT) {
      loadMoviesRef.current([...activeGenresRef.current], true);
    }
  }, [currentIndex, movies.length, swipeCount, loading]); // eslint-disable-line react-hooks/exhaustive-deps


  // Toggle genre chip — refetch with new filters
  const toggleGenreChip = useCallback((genreId) => {
    const next = new Set(activeGenresRef.current);
    if (next.has(genreId)) next.delete(genreId);
    else next.add(genreId);
    setActiveGenres(next);
    activeGenresRef.current = next;
    loadMoviesRef.current([...next]);
  }, []);

  const clearGenreFilters = useCallback(() => {
    setActiveGenres(new Set());
    activeGenresRef.current = new Set();
    loadMoviesRef.current([]);
  }, []);

  // ─── SWIPE ACTION ───
  const handleAction = useCallback((action) => {
    if (swipingRef.current) return;
    const movie = movies[currentIndex];
    if (!movie) return;

    // Guest gate: block save/maybe/watched but allow skip
    if (isGuest && action !== "skip" && guardAction) {
      guardAction(() => {}); // shows the sign-in modal
      return;
    }

    // "watched" opens the rating modal instead of swiping
    if (action === "watched") {
      setWatchedModal(movie);
      setWatchedSlider(75);
      return;
    }

    swipingRef.current = true;
    const dir = action === "skip" ? "left" : "right";
    setSwipeDir(dir);

    if (action === "skip") setShowStamp("nope");
    else setShowStamp("like");

    setTimeout(() => { // matches 250ms swipe-out animation
      if (action === "save") {
        if (!savedIds.has(movie.id)) toggleSave(movie);
      } else if (action === "later") {
        setMaybeLater((prev) => {
          if (prev.some((m) => m.id === movie.id)) return prev;
          return [{ ...movie, addedAt: Date.now() }, ...prev].slice(0, 50);
        });
        Toast.fire({ icon: "success", title: "Saved for later" });
      } else if (action === "skip") {
        Toast.fire({ icon: "success", title: "Movie skipped" });
      }

      setSwipeCount((c) => c + 1);
      setUndoHistory((prev) => [{ movie, action, index: currentIndex }, ...prev].slice(0, 5));
      setCurrentIndex((i) => i + 1);
      setCardKey((k) => k + 1);
      setCounterBump(true);
      setTimeout(() => setCounterBump(false), 200);
      setSwipeDir(null);
      setShowStamp(null);
      setDragX(0);
      swipingRef.current = false;

      // Fire-and-forget: record swipe to Supabase
      if (user) {
        const dbAction = action === "save" ? "liked" :
                         action === "skip" ? "disliked" :
                         action === "later" ? "skipped" : "skipped";
        const genreScores = computeGenreScores(movie, dbAction);
        discoverService.recordSwipe(user.id, movie.id, dbAction, genreScores).catch(syncFailToast);
      }
    }, 250);
  }, [movies, currentIndex, savedIds, toggleSave, isGuest, guardAction, user]);

  // Save from the "Already Watched" mini modal
  const handleWatchedSave = useCallback(() => {
    if (!watchedModal) return;
    toggleWatched(watchedModal);
    setWatchedRating(watchedModal.id, watchedSlider);
    setWatchedModal(null);
    setSwipeCount((c) => c + 1);
    setCurrentIndex((i) => i + 1);
    setCardKey((k) => k + 1);
    setCounterBump(true);
    setTimeout(() => setCounterBump(false), 200);
    // Fire-and-forget: record as "liked" in Supabase (watched = positive signal)
    if (user) {
      const genreScores = computeGenreScores(watchedModal, "liked");
      discoverService.recordSwipe(user.id, watchedModal.id, "liked", genreScores).catch(syncFailToast);
    }
  }, [watchedModal, watchedSlider, toggleWatched, setWatchedRating, user]);

  const handleSwipe = useCallback((direction) => {
    handleAction(direction === "right" ? "save" : "skip");
  }, [handleAction]);

  const handleUndo = useCallback(() => {
    if (undoHistory.length === 0) return;
    const { movie, action, index } = undoHistory[0];
    if (action === "save") {
      if (savedIds.has(movie.id)) toggleSave(movie);
    }
    if (action === "later") {
      setMaybeLater((prev) => prev.filter((m) => m.id !== movie.id));
    }
    setSwipeCount((c) => Math.max(0, c - 1));
    setCurrentIndex(index);
    setUndoHistory((prev) => prev.slice(1));
  }, [undoHistory, savedIds, toggleSave]);

  // Touch handlers
  const handleTouchStart = (e) => {
    if (swipingRef.current) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontalSwipe.current = false;
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!isDragging || swipingRef.current) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isHorizontalSwipe.current && Math.abs(dx) > 10) {
      isHorizontalSwipe.current = Math.abs(dx) > Math.abs(dy);
    }
    if (isHorizontalSwipe.current) {
      e.preventDefault();
      setDragX(dx);
    }
  };

  const handleTouchEnd = () => {
    if (swipingRef.current) return;
    setIsDragging(false);
    if (Math.abs(dragX) > 80) {
      handleSwipe(dragX > 0 ? "right" : "left");
    } else {
      setDragX(0);
    }
  };

  const handleMouseDown = (e) => {
    if (swipingRef.current) return;
    touchStartX.current = e.clientX;
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || swipingRef.current) return;
    setDragX(e.clientX - touchStartX.current);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    if (!isDragging || swipingRef.current) return;
    setIsDragging(false);
    if (Math.abs(dragX) > 80) {
      handleSwipe(dragX > 0 ? "right" : "left");
    } else {
      setDragX(0);
    }
  }, [isDragging, dragX, handleSwipe]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Auto-skip movies that entered the exclusion set mid-session
  useEffect(() => {
    if (movies.length === 0) return;
    if (currentIndex < movies.length && exclusionSet.has(movies[currentIndex].id)) {
      let next = currentIndex + 1;
      while (next < movies.length && exclusionSet.has(movies[next].id)) next++;
      setCurrentIndex(next);
    }
  }, [exclusionSet, currentIndex, movies]);

  const currentMovie = currentIndex < movies.length ? movies[currentIndex] : undefined;
  const nextMovie = currentIndex + 1 < movies.length ? movies[currentIndex + 1] : undefined;
  const thirdMovie = currentIndex + 2 < movies.length ? movies[currentIndex + 2] : undefined;
  const rotation = Math.max(-12, Math.min(12, dragX * 0.08));
  const opacity = Math.min(Math.abs(dragX) / 80, 1);
  const tagline = currentMovie ? (cardDetails[currentMovie.id]?.tagline || "") : "";

  // Loading skeleton
  if (loading) {
    return (
      <div className="discover-container">
        <div className="discover-header">
          <div className="discover-undo-btn disabled"><UndoIcon /></div>
          <span className="discover-session-count" style={{ opacity: 0.3 }}>0 DISCOVERED · 30 REMAINING</span>
          <div className="discover-undo-btn disabled">
            <ShuffleIcon size={14} />
          </div>
          <div className="genre-dropdown" style={{ marginTop: 0 }}>
            <div className="genre-dropdown-trigger" style={{ opacity: 0.3 }}>
              <span>GENRE</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>
        <div className="discover-content">
          <div className="discover-stack">
            <div className="discover-card discover-skeleton-card">
              <div className="discover-skeleton-poster">
                <div className="discover-skeleton-gradient" />
                <div className="discover-skeleton-lines">
                  <div className="discover-skeleton-line discover-skeleton-title-line" />
                  <div className="discover-skeleton-line discover-skeleton-meta-line" />
                  <div className="discover-skeleton-pills-row">
                    <div className="discover-skeleton-pill" />
                    <div className="discover-skeleton-pill short" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="discover-actions">
          <div className="discover-action-group">
            <div className="discover-action-btn discover-skip-btn" style={{ opacity: 0.3 }}><SwipeXIcon /></div>
            <span className="discover-action-label" style={{ opacity: 0.3 }}>Skip</span>
          </div>
          <div className="discover-action-group">
            <div className="discover-action-btn discover-like-btn" style={{ opacity: 0.3 }}><SwipeHeartIcon /></div>
            <span className="discover-action-label" style={{ opacity: 0.3 }}>Save</span>
          </div>
          <div className="discover-action-group">
            <div className="discover-action-btn discover-watched-btn" style={{ opacity: 0.3 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <span className="discover-action-label" style={{ opacity: 0.3 }}>Watched</span>
          </div>
          <div className="discover-action-group">
            <div className="discover-action-btn discover-maybe-btn" style={{ opacity: 0.3 }}><ClockIcon /></div>
            <span className="discover-action-label" style={{ opacity: 0.3 }}>Later</span>
          </div>
        </div>
      </div>
    );
  }

  // Batch complete (30 movies)
  if (swipeCount >= SESSION_LIMIT && !loading) {
    return (
      <div className="discover-container">
        <div className="discover-empty">
          <div className="discover-empty-icon">
            <DiscoverIcon />
          </div>
          <h3>30 movies explored</h3>
          <p>Shuffle for a fresh batch</p>
          <button className="discover-reset-btn" onClick={() => loadMoviesRef.current([...activeGenresRef.current])}>
            <ShuffleIcon style={{ marginRight: 6, verticalAlign: -3 }} />
            Shuffle
          </button>
        </div>
      </div>
    );
  }

  // Empty / exhausted
  if (!currentMovie && !loading) {
    const hasGenreFilter = activeGenres.size > 0;
    const genreLabels = hasGenreFilter ? GENRE_FILTERS.filter(g => activeGenres.has(g.id)).map(g => g.label) : [];
    const genreText = genreLabels.length <= 2
      ? genreLabels.join(" & ")
      : genreLabels.slice(0, -1).join(", ") + " & " + genreLabels[genreLabels.length - 1];

    return (
      <div className="discover-container">
        <div className="discover-empty">
          <div className="discover-empty-icon">
            <DiscoverIcon />
          </div>
          {hasGenreFilter ? (
            <>
              <h3>You've discovered all {genreText} movies!</h3>
              <p>Try adding more genres or clear filters to explore everything</p>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button className="discover-reset-btn" style={{ background: "transparent", border: "1.5px solid var(--border)", color: "var(--text-secondary)" }} onClick={clearGenreFilters}>
                  Clear filters
                </button>
                <button className="discover-reset-btn" onClick={() => loadMoviesRef.current([...activeGenresRef.current])}>
                  <ShuffleIcon style={{ marginRight: 6, verticalAlign: -3 }} />
                  Shuffle
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>No more movies found</h3>
              <p>Shuffle for a fresh batch</p>
              <button className="discover-reset-btn" onClick={() => loadMoviesRef.current([...activeGenresRef.current])}>
                <ShuffleIcon style={{ marginRight: 6, verticalAlign: -3 }} />
                Shuffle
              </button>
            </>
          )}
          {swipeCount > 0 && (
            <div className="discover-session-stat">{swipeCount} movies discovered this session</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="discover-container">
      {/* Header: undo + counter + filter icon */}
      <div className="discover-header discover-enter">
        <button
          className={`discover-undo-btn ${undoHistory.length === 0 ? "disabled" : ""}`}
          onClick={handleUndo}
          disabled={undoHistory.length === 0}
          title="Undo"
        >
          <UndoIcon />
        </button>
        <span className={`discover-session-count${counterBump ? " bump" : ""}`}>
          {swipeCount} DISCOVERED · {Math.max(0, SESSION_LIMIT - swipeCount)} REMAINING
        </span>
        <button className="discover-undo-btn" onClick={() => loadMoviesRef.current([...activeGenresRef.current])} title="Shuffle">
          <ShuffleIcon size={20} />
        </button>
        <div className="genre-dropdown" ref={filterDropdownRef} style={{ marginTop: 0 }}>
          <button
            className={`genre-dropdown-trigger ${activeGenres.size > 0 ? "active" : ""}`}
            ref={discoverGenreFloating.refs.setReference}
            onClick={() => setFilterOpen(f => !f)}
            aria-expanded={filterOpen}
          >
            <span>{activeGenres.size > 0 ? `GENRE · ${activeGenres.size}` : "GENRE"}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div
            className="genre-dropdown-panel"
            ref={discoverGenreFloating.refs.setFloating}
            style={{
              ...discoverGenreFloating.floatingStyles,
              opacity: filterOpen ? 1 : 0,
              pointerEvents: filterOpen ? 'auto' : 'none',
              transform: `${discoverGenreFloating.floatingStyles?.transform || ''} translateY(${filterOpen ? '0' : '-4px'})`.trim(),
              transition: 'opacity 0.15s ease, transform 0.15s ease',
            }}
          >
            {GENRE_FILTERS.map((g) => (
              <button
                key={g.id}
                className={`genre-option ${activeGenres.has(g.id) ? "active" : ""}`}
                onClick={() => toggleGenreChip(g.id)}
              >
                <span className="genre-option-check">{activeGenres.has(g.id) ? "✓" : ""}</span>
                {g.label}
              </button>
            ))}
            {activeGenres.size > 0 && (
              <button className="genre-clear-btn" onClick={() => { clearGenreFilters(); setFilterOpen(false); }}>
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content: card */}
      <div className="discover-content discover-enter">
        {/* Card stack */}
        <div className="discover-stack">
          {thirdMovie && (
            <div className="discover-card discover-card-third">
              <div className="discover-card-poster" style={{ backgroundImage: `url(${IMG_BASE}/w780${thirdMovie.poster_path})` }} />
              <div className="discover-card-gradient" />
            </div>
          )}
          {nextMovie && (
            <div className={`discover-card discover-card-next ${swipeDir ? "discover-card-promote" : ""}`}>
              <div className="discover-card-poster" style={{ backgroundImage: `url(${IMG_BASE}/w780${nextMovie.poster_path})` }} />
              <div className="discover-card-gradient" />
            </div>
          )}
          {currentMovie && (
            <div
              key={cardKey}
              className={`discover-card discover-card-active ${swipeDir ? `swipe-${swipeDir}` : "card-enter"}`}
              style={{
                transform: swipeDir ? undefined : `translateX(${dragX}px) rotate(${rotation}deg)`,
                transition: isDragging ? "none" : "transform 300ms cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onMouseDown={handleMouseDown}
            >
              <div className="discover-card-poster" style={{ backgroundImage: `url(${IMG_BASE}/w780${currentMovie.poster_path})` }} />
              <div className="discover-card-gradient" />
              <div className="discover-stamp discover-stamp-like" style={{ opacity: dragX > 20 ? opacity : 0 }}>SAVE</div>
              <div className="discover-stamp discover-stamp-nope" style={{ opacity: dragX < -20 ? opacity : 0 }}>SKIP</div>
              {showStamp === "like" && <div className="discover-stamp discover-stamp-like discover-stamp-flash">SAVE</div>}
              {showStamp === "nope" && <div className="discover-stamp discover-stamp-nope discover-stamp-flash">SKIP</div>}
              <div className="discover-glow discover-glow-right" style={{ opacity: dragX > 20 ? opacity * 0.5 : 0 }} />
              <div className="discover-glow discover-glow-left" style={{ opacity: dragX < -20 ? opacity * 0.5 : 0 }} />
              <button className="discover-info-float" onClick={() => setSelectedMovie(currentMovie)}>
                <InfoIcon />
              </button>
              <div className="discover-card-info">
                <div className="discover-card-title">{currentMovie.title}</div>
                <div className="discover-card-meta">
                  <span>{currentMovie.year}</span>
                  <span className="discover-meta-dot" />
                  <span className="discover-card-rating" style={{ color: getRatingColor(currentMovie.rating) }}>
                    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 13, height: 13, marginRight: 3, verticalAlign: -1 }}>
                      <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
                    </svg>
                    {currentMovie.rating}
                  </span>
                </div>
                <div className="discover-card-pills">
                  <span
                    className="discover-genre-pill"
                    style={{ background: `${GENRE_COLORS[currentMovie.genre] || "#7A7878"}33`, color: GENRE_COLORS[currentMovie.genre] || "#7A7878" }}
                  >
                    {currentMovie.genre}
                  </span>
                </div>
                {tagline && <div className="discover-card-tagline">{tagline}</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Watched mini modal */}
      {watchedModal && (
        <div className="discover-watched-modal">
          <div className="discover-watched-title">{watchedModal.title}</div>
          <div className="discover-watched-slider-row">
            <span className="discover-watched-val" style={{ color: getRatingColor((watchedSlider / 10).toFixed(1)) }}>{watchedSlider}</span>
            <input
              type="range" min="1" max="100" value={watchedSlider}
              onChange={(e) => setWatchedSlider(Number(e.target.value))}
              className="discover-watched-range"
            />
          </div>
          <div className="discover-watched-btns">
            <button className="discover-watched-cancel" onClick={() => setWatchedModal(null)}>Cancel</button>
            <button className="discover-watched-save" onClick={handleWatchedSave}>Save to Journal</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="discover-actions discover-enter">
        <div className="discover-action-group">
          <button className="discover-action-btn discover-skip-btn" onClick={() => handleAction("skip")} aria-label="Skip">
            <SwipeXIcon />
          </button>
          <span className="discover-action-label">Skip</span>
        </div>
        <div className="discover-action-group">
          <button className="discover-action-btn discover-like-btn" onClick={() => handleAction("save")} aria-label="Save to watchlist">
            <SwipeHeartIcon />
          </button>
          <span className="discover-action-label">Save</span>
        </div>
        <div className="discover-action-group">
          <button className="discover-action-btn discover-watched-btn" onClick={() => handleAction("watched")} aria-label="Already watched">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 22, height: 22 }}>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          <span className="discover-action-label">Watched</span>
        </div>
        <div className="discover-action-group">
          <button className="discover-action-btn discover-maybe-btn" onClick={() => handleAction("later")} aria-label="Save for later">
            <ClockIcon />
          </button>
          <span className="discover-action-label">Later</span>
        </div>
      </div>

      {selectedMovie && (
        <MovieModal
          key={selectedMovie.id}
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          isSaved={savedIds.has(selectedMovie.id)}
          onToggleSave={toggleSave}
          onMovieSelect={setSelectedMovie}
          savedIds={savedIds}
          isWatched={watchedIds.has(selectedMovie.id)}
          onToggleWatched={toggleWatched}
          onStartDebrief={startDebrief}
          collections={collections}
          toggleMovieInCollection={toggleMovieInCollection}
          rating={watchedRatings?.get(selectedMovie.id) ?? null}
          onSetRating={setWatchedRating}
        />
      )}
    </div>
  );
}

// ─── Auth Components ────────────────────────────────────────────────────────────

function sanitizeText(str) {
  if (typeof str !== "string") return "";
  return str.replace(/<[^>]*>/g, "").slice(0, 2000);
}

function LoginScreen() {
  const { signInWithGoogle, continueAsGuest, signInCooldown, signInError } = useAuth();
  const [movies, setMovies] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [showcaseReady, setShowcaseReady] = useState(false);
  const [formReady, setFormReady] = useState(false);
  const intervalRef = useRef(null);

  // Detect system theme for login screen (independent of app theme)
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches !== false
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Fetch trending movies on mount
  useEffect(() => {
    getTrending(1).then(({ movies: results }) => {
      const withBackdrops = results.filter((m) => m.backdrop_path).slice(0, 10);
      setMovies(withBackdrops);
      // Preload first two images
      withBackdrops.slice(0, 2).forEach((m) => {
        const img = new Image();
        img.src = `${IMG_BASE}/w1280${m.backdrop_path}`;
      });
      // Stagger entrance
      setTimeout(() => setShowcaseReady(true), 100);
      setTimeout(() => setFormReady(true), 400);
    }).catch(() => {
      setShowcaseReady(true);
      setTimeout(() => setFormReady(true), 200);
    });
  }, []);

  // Auto-rotate backdrops every 5 seconds
  useEffect(() => {
    if (movies.length < 2) return;
    intervalRef.current = setInterval(() => {
      setActiveIndex((i) => (i + 1) % movies.length);
    }, 5000);
    return () => clearInterval(intervalRef.current);
  }, [movies]);

  // Preload next image
  useEffect(() => {
    if (movies.length < 2) return;
    const nextIdx = (activeIndex + 1) % movies.length;
    const next = movies[nextIdx];
    if (next?.backdrop_path) {
      const img = new Image();
      img.src = `${IMG_BASE}/w1280${next.backdrop_path}`;
    }
  }, [activeIndex, movies]);

  const current = movies[activeIndex];

  return (
    <div className={`login-screen ${systemDark ? "login-dark" : "login-light"}`}>
      {/* Left / Top — Cinematic Showcase */}
      <div className={`login-showcase ${showcaseReady ? "login-visible" : ""}`}>
        {movies.map((movie, i) => (
          <div key={movie.id} className={`login-backdrop ${i === activeIndex ? "login-backdrop-active" : ""}`}>
            <img
              src={`${IMG_BASE}/w1280${movie.backdrop_path}`}
              alt=""
              className="login-backdrop-img"
              loading={i < 2 ? "eager" : "lazy"}
            />
          </div>
        ))}
        <div className="login-showcase-gradient" />
        {current && (
          <div className="login-showcase-meta" key={activeIndex}>
            <h2 className="login-showcase-title">{current.title}</h2>
            <p className="login-showcase-info">{current.genre} · {current.year}</p>
          </div>
        )}
        {movies.length > 1 && (
          <div className="login-showcase-dots">
            {movies.map((_, i) => (
              <button
                key={i}
                className={`login-showcase-dot ${i === activeIndex ? "login-dot-active" : ""}`}
                onClick={() => { setActiveIndex(i); clearInterval(intervalRef.current); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right / Bottom — Login Form */}
      <div className={`login-form-side ${formReady ? "login-visible" : ""}`}>
        <div className="login-form-inner">
          <div className="login-stagger login-stagger-1"><CinnoLogo size={64} /></div>
          <h1 className="login-title login-stagger login-stagger-2">Cinno</h1>
          <p className="login-subtitle login-stagger login-stagger-3">
            Your movie companion for discovering, tracking, and debriefing films.
          </p>

          <button
            className="login-google-btn login-stagger login-stagger-4"
            onClick={signInWithGoogle}
            disabled={signInCooldown}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" className="login-google-icon">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {signInCooldown ? "Please wait..." : "Sign in with Google"}
          </button>

          {signInError && <p className="login-error login-stagger login-stagger-4">{signInError}</p>}

          <button className="login-guest-btn login-stagger login-stagger-5" onClick={continueAsGuest}>
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
}

function GuestRestrictionModal({ onClose }) {
  const { signInWithGoogle, signInCooldown, signInError } = useAuth();
  const guestOverlayRef = useRef(null);
  const guestModalRef = useRef(null);
  const guestClosing = useRef(false);
  const handleGuestClose = useCallback(() => {
    if (guestClosing.current) return;
    guestClosing.current = true;
    if (guestModalRef.current) {
      guestModalRef.current.style.transition = "transform 200ms ease-in, opacity 200ms ease-in";
      guestModalRef.current.style.transform = "scale(0.95)";
      guestModalRef.current.style.opacity = "0";
    }
    if (guestOverlayRef.current) {
      guestOverlayRef.current.style.transition = "opacity 150ms ease-in 50ms";
      guestOverlayRef.current.style.opacity = "0";
    }
    setTimeout(() => onClose(), 200);
  }, [onClose]);

  return createPortal(
    <div className="guest-modal-overlay" ref={guestOverlayRef} onClick={handleGuestClose}>
      <div className="guest-modal" ref={guestModalRef} onClick={(e) => e.stopPropagation()}>
        <div className="guest-modal-icon">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h2 className="guest-modal-title">Sign in to unlock this feature</h2>
        <p className="guest-modal-desc">Create an account to save movies, write reviews, chat with AI, and more.</p>

        <button
          className="login-google-btn"
          onClick={signInWithGoogle}
          disabled={signInCooldown}
        >
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          {signInCooldown ? "Please wait..." : "Sign in with Google"}
        </button>

        {signInError && <p className="login-error">{signInError}</p>}

        <button className="guest-modal-dismiss" onClick={handleGuestClose}>
          Continue browsing
        </button>
      </div>
    </div>,
    document.body
  );
}

function useGuestGate() {
  const { user, isGuest, isAuthenticated } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const guardAction = useCallback((action) => {
    // Always re-check auth state on every restricted action
    if (!isAuthenticated() && isGuest) {
      setShowModal(true);
      return;
    }
    if (!user && !isGuest) {
      setShowModal(true);
      return;
    }
    action();
  }, [user, isGuest, isAuthenticated]);

  const modal = showModal ? <GuestRestrictionModal onClose={() => setShowModal(false)} /> : null;

  return { guardAction, guestModal: modal };
}

const UserIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

// ─── Main App ──────────────────────────────────────────────────────────────────

const MAIN_TAB_ORDER = { search: 0, saved: 1, discover: 2, journal: 3, chat: 4 };

const IS_SHARED_VIEW = new URLSearchParams(window.location.search).has("shared");

function AppRouter() {
  if (IS_SHARED_VIEW) {
    return <SharedWatchlistView />;
  }
  return <AuthGate />;
}

function AuthGate() {
  const { user, loading, isGuest } = useAuth();

  if (loading) {
    // The HTML splash screen handles the loading state visually
    return null;
  }

  if (!user && !isGuest) {
    return <LoginScreen />;
  }

  return <ErrorBoundary><MainApp /></ErrorBoundary>;
}

export default function App() {
  return <AppRouter />;
}

function MainApp() {
  const { user, isGuest, signOut, signInWithGoogle, registerSignOutCallback } = useAuth();

  // ── Set user-scoped localStorage prefix BEFORE any useState initializers ──
  const userId = user?.id || null;
  if (userId && _storageUserId !== userId) {
    migrateGuestDataToUser(userId);
  }
  _storageUserId = userId;

  const { guardAction, guestModal } = useGuestGate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const headerMenuFloating = useFloating({
    open: userMenuOpen,
    placement: "bottom-end",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  // Close user menu on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  // Initialize AOS (Animate On Scroll) globally
  useEffect(() => {
    AOS.init({ duration: 600, easing: "ease-out", once: false });
  }, []);

  const [activeTab, _setActiveTab] = useState("search");
  const prevTabRef = useRef("search");
  const [tabDir, setTabDir] = useState(null);
  const [tabFading, setTabFading] = useState(false);
  const tabFadeTimer = useRef(null);
  const setActiveTab = useCallback((t) => {
    if (t === prevTabRef.current) return;
    if (tabFadeTimer.current) clearTimeout(tabFadeTimer.current);
    setTabFading(true);
    tabFadeTimer.current = setTimeout(() => {
      setTabDir("fade-in");
      prevTabRef.current = t;
      _setActiveTab(t);
      setTabFading(false);
      setTimeout(() => AOS.refresh(), 50);
    }, 150);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollPositions = useRef({});

  const [theme, setTheme] = useState(() => loadFromStorage("cc_theme", "dark"));
  const [savedIds, setSavedIds] = useState(() => new Set(loadFromStorage("cc_savedIds", [])));
  const [savedMovies, setSavedMovies] = useState(() => new Map(loadFromStorage("cc_savedMovies", [])));
  const [listsLoading, setListsLoading] = useState(() => !!user);
  const [watchedIds, setWatchedIds] = useState(() => new Set(loadFromStorage("cc_watchedIds", [])));
  const [watchedMovies, setWatchedMovies] = useState(() => new Map(loadFromStorage("cc_watchedMovies", [])));
  const [watchedNotes, setWatchedNotes] = useState(() => new Map(loadFromStorage("cc_watchedNotes", [])));
  const [watchedRatings, setWatchedRatings] = useState(() => new Map(loadFromStorage("cc_watchedRatings", [])));
  const [tasteProfile, setTasteProfile] = useState(() => loadFromStorage("cc_tasteProfile", ""));
  const [debriefPayload, setDebriefPayload] = useState(null);
  const [collections, setCollections] = useState(() => {
    const stored = loadFromStorage("cc_collections", null);
    if (stored) {
      // Ensure "Must Watch" collection exists
      if (!stored.some((c) => c.name === "Must Watch")) {
        return [...stored, { id: "must_watch", name: "Must Watch", movieIds: [], isDefault: true }];
      }
      return stored;
    }
    return [
      { id: "favourites", name: "Favourites", movieIds: [], isDefault: true },
      { id: "must_watch", name: "Must Watch", movieIds: [], isDefault: true },
    ];
  });
  const [unlockedBadges, setUnlockedBadges] = useState(() => loadFromStorage("cc_badges", []));
  const [watchedDates, setWatchedDates] = useState(() => new Map(loadFromStorage("cc_watchedDates", [])));
  const [activeMilestone, setActiveMilestone] = useState(null);
  const prevWatchedCount = useRef(watchedIds.size);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatsLoading, setChatsLoading] = useState(true);
  const watchlistIdRef = useRef(null); // Supabase UUID of the default Watchlist collection
  const journalEntryIds = useRef(new Map()); // tmdb_id → Supabase journal_entries UUID

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveToStorage("cc_theme", theme);
    if (user) preferencesService.updateThemeSettings(user.id, { theme }).catch(syncFailToast);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTheme = () => setTheme((t) => t === "dark" ? "light" : "dark");

  const resetReactState = useCallback(() => {
    setSavedIds(new Set());
    setSavedMovies(new Map());
    setWatchedIds(new Set());
    setWatchedMovies(new Map());
    setWatchedNotes(new Map());
    setWatchedRatings(new Map());
    setTasteProfile("");
    setCollections([
      { id: "favourites", name: "Favourites", movieIds: [], isDefault: true },
      { id: "must_watch", name: "Must Watch", movieIds: [], isDefault: true },
    ]);
    setUnlockedBadges([]);
    setWatchedDates(new Map());
    setChats([]);
    setActiveChatId(null);
    setChatsLoading(true);
    watchlistIdRef.current = null;
    journalEntryIds.current = new Map();
  }, []);

  // Reset React state only — does NOT touch localStorage.
  // Used on sign-out so the user's data stays in their prefixed keys.
  const resetAppState = useCallback(() => {
    // Null the prefix FIRST so any save-effects triggered by the state
    // resets below write to non-prefixed (throwaway) keys, not the user's.
    _storageUserId = null;
    resetReactState();
  }, [resetReactState]);

  // Delete user's localStorage data AND reset React state.
  // Used by the "Clear all data" button in Settings.
  const clearAllData = useCallback(() => {
    USER_DATA_KEYS.forEach((k) => localStorage.removeItem(scopedKey(k)));
    resetReactState();
  }, [resetReactState]);

  // Register sign-out callback — preserves localStorage, only resets React state
  useEffect(() => {
    registerSignOutCallback(resetAppState);
  }, [registerSignOutCallback, resetAppState]);

  // ── Load watchlist & collections from Supabase (authenticated) ──
  useEffect(() => {
    if (!user) { watchlistIdRef.current = null; setListsLoading(false); return; }
    let cancelled = false;
    const load = async () => {
      try {
        // Migrate localStorage data to Supabase on first login
        const localSavedIds = loadFromStorage("cc_savedIds", []);
        const localSavedMovies = loadFromStorage("cc_savedMovies", []);
        const localCollections = loadFromStorage("cc_collections", []);
        if (localSavedIds.length > 0 || localCollections.length > 0) {
          const migrated = await watchlistService.migrateLocalWatchlist(user.id, {
            savedIds: localSavedIds,
            savedMovies: localSavedMovies,
            collections: localCollections,
          });
          if (migrated) {
            removeFromStorage("cc_savedIds");
            removeFromStorage("cc_savedMovies");
            removeFromStorage("cc_collections");
          }
        }

        // Ensure default Watchlist exists
        const wlId = await watchlistService.ensureDefaultCollection(user.id);
        if (cancelled) return;
        watchlistIdRef.current = wlId;

        // Load full state from Supabase
        const state = await watchlistService.loadFullWatchlistState(user.id);
        if (cancelled) return;
        setSavedIds(new Set(state.savedIds));
        setSavedMovies(new Map(state.savedMovies));
        setCollections(state.collections);

        // Update localStorage cache for offline/fast loads
        saveToStorage("cc_savedIds", state.savedIds);
        saveToStorage("cc_savedMovies", state.savedMovies);
        saveToStorage("cc_collections", state.collections);
      } catch (e) {
        console.error("Failed to load watchlist from Supabase, using localStorage:", e);
        // Keep localStorage state already loaded via useState initializers
      } finally {
        if (!cancelled) setListsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // ── Load chats from Supabase (authenticated) or localStorage (guest) ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (user) {
        try {
          // Migrate localStorage chat data to Supabase on first login
          const localChats = loadFromStorage("cc_chats", []);
          if (localChats.length > 0) {
            const migrated = await chatService.migrateLocalStorageChats(user.id, localChats);
            if (migrated && migrated.length > 0) {
              removeFromStorage("cc_chats");
              removeFromStorage("cc_activeChatId");
            }
          }
          // Fetch all conversations + messages from Supabase
          const loaded = await chatService.loadAllChats(user.id);
          if (cancelled) return;
          if (loaded.length > 0) {
            setChats(loaded);
            const storedActiveId = loadFromStorage("cc_activeChatId", null);
            const validActive = loaded.find((c) => c.id === storedActiveId);
            setActiveChatId(validActive ? storedActiveId : loaded[0].id);
          } else {
            // No chats yet — create a default empty one
            const conv = await chatService.createConversation(user.id, "New chat");
            if (cancelled) return;
            setChats([{ id: conv.id, title: "New chat", messages: [] }]);
            setActiveChatId(conv.id);
          }
        } catch (e) {
          console.error("Failed to load chats from Supabase, falling back to localStorage:", e);
          if (cancelled) return;
          const fallbackId = "default";
          const local = loadFromStorage("cc_chats", [{ id: fallbackId, title: "New chat", messages: [] }]);
          setChats(local);
          setActiveChatId(loadFromStorage("cc_activeChatId", local[0]?.id || fallbackId));
        }
      } else {
        // Guest — use localStorage
        const fallbackId = "default";
        const local = loadFromStorage("cc_chats", [{ id: fallbackId, title: "New chat", messages: [] }]);
        setChats(local);
        setActiveChatId(loadFromStorage("cc_activeChatId", local[0]?.id || fallbackId));
      }
      if (!cancelled) setChatsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // ── Load user preferences from Supabase (authenticated) ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      try {
        // Gather localStorage preference values for potential migration
        const localPrefs = {
          theme_settings: { theme: loadFromStorage("cc_theme", "dark") },
          ui_toggles: {
            smartMode: loadFromStorage("cinno-smart-mode", false),
            badgeShowcase: loadFromStorage("cc_badge_showcase", []),
            rankSort: loadFromStorage("cc_rankSort", "rating_desc"),
            journalSort: loadFromStorage("cc_journalSort", "date_desc"),
          },
          genre_preferences: {
            tasteProfile: loadFromStorage("cc_tasteProfile", ""),
            discoverMaybeLater: loadFromStorage("cc_discover_maybe_later", []),
          },
        };

        // Attempt one-time migration (no-ops if row already exists)
        await preferencesService.migrateLocalPreferences(user.id, localPrefs);

        // Fetch authoritative preferences from Supabase
        const prefs = await preferencesService.getPreferences(user.id);
        if (cancelled) return;

        // Apply Supabase values → React state + localStorage cache
        const t = prefs.theme_settings?.theme;
        if (t && t !== theme) {
          setTheme(t);
        }

        const tp = prefs.genre_preferences?.tasteProfile;
        if (tp !== undefined && tp !== tasteProfile) {
          setTasteProfile(tp);
        }
      } catch (e) {
        console.error("Failed to load preferences:", e);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ Intentionally omit theme/tasteProfile — we only want to run on login, not on every state change

  // ── Load journal from Supabase (authenticated) ──
  useEffect(() => {
    if (!user) { journalEntryIds.current = new Map(); return; }
    let cancelled = false;
    const load = async () => {
      try {
        // Migrate localStorage journal data to Supabase on first login
        const localWatchedIds = loadFromStorage("cc_watchedIds", []);
        if (localWatchedIds.length > 0) {
          const migrated = await journalService.migrateLocalJournal(user.id, {
            watchedIds: localWatchedIds,
            watchedMovies: loadFromStorage("cc_watchedMovies", []),
            watchedRatings: loadFromStorage("cc_watchedRatings", []),
            watchedDates: loadFromStorage("cc_watchedDates", []),
            watchedNotes: loadFromStorage("cc_watchedNotes", []),
          });
          if (migrated) {
            removeFromStorage("cc_watchedIds");
            removeFromStorage("cc_watchedMovies");
            removeFromStorage("cc_watchedRatings");
            removeFromStorage("cc_watchedDates");
            removeFromStorage("cc_watchedNotes");
          }
        }

        // Load full journal state from Supabase
        const state = await journalService.loadFullJournalState(user.id);
        if (cancelled) return;
        setWatchedIds(new Set(state.watchedIds));
        setWatchedMovies(new Map(state.watchedMovies));
        setWatchedRatings(new Map(state.watchedRatings));
        setWatchedDates(new Map(state.watchedDates));
        setWatchedNotes(new Map(state.watchedNotes));
        journalEntryIds.current = new Map(state.entryIdMap);

        // Update localStorage cache for offline/fast loads
        saveToStorage("cc_watchedIds", state.watchedIds);
        saveToStorage("cc_watchedMovies", state.watchedMovies);
        saveToStorage("cc_watchedRatings", state.watchedRatings);
        saveToStorage("cc_watchedDates", state.watchedDates);
        saveToStorage("cc_watchedNotes", state.watchedNotes);
      } catch (e) {
        console.error("Failed to load journal from Supabase, using localStorage:", e);
        // Keep localStorage state already loaded via useState initializers
      }
    };
    load();
    return () => { cancelled = true; };
  }, [user]);

  // ── Chat CRUD handlers (Supabase-first for authenticated, localStorage for guest) ──

  const handleCreateChat = useCallback(async (title = "New chat", metadata = {}) => {
    if (user) {
      try {
        const conv = await chatService.createConversation(user.id, title, metadata);
        const newChat = { id: conv.id, title, messages: [], ...metadata };
        setChats((prev) => [newChat, ...prev]);
        return conv.id;
      } catch (e) {
        console.error("Failed to create conversation:", e);
      }
    }
    // Guest fallback
    const newId = Date.now().toString();
    setChats((prev) => [{ id: newId, title, messages: [], ...metadata }, ...prev]);
    return newId;
  }, [user]);

  const handleDeleteChat = useCallback(async (id) => {
    if (user) {
      try { await chatService.deleteConversation(id); }
      catch (e) { console.error("Failed to delete conversation:", e); }
    }
    setChats((prev) => prev.filter((c) => c.id !== id));
  }, [user]);

  const handleRenameChat = useCallback(async (id, title) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    if (user) {
      try { await chatService.updateConversationTitle(id, title); }
      catch (e) { console.error("Failed to rename conversation:", e); }
    }
  }, [user]);

  const handleSaveMessage = useCallback(async (chatId, role, content) => {
    const ts = Date.now();
    // Optimistic update — show message immediately
    setChats((prev) => prev.map((c) =>
      c.id === chatId ? { ...c, messages: [...c.messages, { role, content, ts }] } : c
    ));
    if (user) {
      try { await chatService.saveMessage(chatId, role, content); }
      catch (e) { console.error("Failed to save message:", e); }
    }
    return ts;
  }, [user]);

  const handleUpdateChatMetadata = useCallback(async (chatId, metadata) => {
    setChats((prev) => prev.map((c) =>
      c.id === chatId ? { ...c, ...metadata } : c
    ));
    if (user) {
      try { await chatService.updateConversationMetadata(chatId, metadata); }
      catch (e) { console.error("Failed to update conversation metadata:", e); }
    }
  }, [user]);

  const requestClearAllData = () => {
    Swal.fire({
      title: "Clear all Cinno data?",
      text: "This removes your watchlist, journal, ratings, and collections permanently.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Clear",
      confirmButtonColor: "#8B2040",
      cancelButtonText: "Cancel",
      customClass: { popup: "cinno-swal-popup" },
    }).then((result) => {
      if (result.isConfirmed) {
        clearAllData();
        setSettingsOpen(false);
        Toast.fire({ icon: "success", title: "All data cleared" });
      }
    });
  };

  const toggleSave = (movie) => {
    const id = movie.id;
    const wasSaved = savedIds.has(id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSavedMovies((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id); else next.set(id, { ...movie, savedAt: DateTime.now().toISO() });
      return next;
    });
    if (wasSaved) {
      // Remove from all collections too
      setCollections((prev) => prev.map((c) =>
        c.movieIds.includes(id) ? { ...c, movieIds: c.movieIds.filter((mid) => mid !== id) } : c
      ));
      // Supabase: remove from Watchlist (cascade removes from other collections via app logic)
      if (user && watchlistIdRef.current) {
        watchlistService.removeMovieFromCollection(watchlistIdRef.current, id).catch(syncFailToast);
        // Also remove from all user collections in Supabase
        collections.forEach((col) => {
          if (col.movieIds.includes(id)) {
            watchlistService.removeMovieFromCollection(col.id, id).catch(syncFailToast);
          }
        });
      }
      showToast("Removed from watchlist", () => {
        setSavedIds((prev) => new Set(prev).add(id));
        setSavedMovies((prev) => new Map(prev).set(id, movie));
        // Undo: re-add to Supabase
        if (user && watchlistIdRef.current) {
          watchlistService.addMovieToCollection(watchlistIdRef.current, movie).catch(syncFailToast);
        }
      });
    } else {
      // Supabase: add to Watchlist + cache movie data
      if (user && watchlistIdRef.current) {
        watchlistService.addMovieToCollection(watchlistIdRef.current, movie).catch(syncFailToast);
      }
      showToast("Added to watchlist");
    }
  };

  const toggleWatched = (movie) => {
    const id = movie.id;
    const wasWatched = watchedIds.has(id);
    if (wasWatched) {
      Swal.fire({
        title: `Remove "${movie.title}"?`,
        text: "Remove from your journal? Your rating and notes will be lost.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Remove",
        confirmButtonColor: "#8B2040",
        cancelButtonText: "Cancel",
        customClass: { popup: "cinno-swal-popup" },
      }).then((result) => {
        if (result.isConfirmed) {
          const prevDate = watchedDates.get(id);
          const prevNote = watchedNotes.get(id);
          const prevRating = watchedRatings.get(id);
          const prevEntryId = journalEntryIds.current.get(id);
          setWatchedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
          setWatchedMovies((prev) => { const next = new Map(prev); next.delete(id); return next; });
          setWatchedDates((prev) => { const next = new Map(prev); next.delete(id); return next; });
          // Supabase: delete journal entry
          if (user && prevEntryId) {
            journalEntryIds.current.delete(id);
            journalService.deleteJournalEntry(prevEntryId).catch(syncFailToast);
          }
          showToast("Removed from journal", () => {
            setWatchedIds((prev) => new Set(prev).add(id));
            setWatchedMovies((prev) => new Map(prev).set(id, movie));
            if (prevDate) setWatchedDates((prev) => new Map(prev).set(id, prevDate));
            if (prevNote !== undefined) setWatchedNotes((prev) => new Map(prev).set(id, prevNote));
            if (prevRating !== undefined) setWatchedRatings((prev) => new Map(prev).set(id, prevRating));
            // Supabase: re-add on undo
            if (user) {
              journalService.addJournalEntry(user.id, movie, {
                personalRating: prevRating ?? null,
                watchDate: prevDate ?? null,
                notes: prevNote ?? null,
              }).then((entry) => {
                if (entry) journalEntryIds.current.set(id, entry.id);
              }).catch(syncFailToast);
            }
          });
        }
      });
      return;
    }
    setWatchedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setWatchedMovies((prev) => {
      const next = new Map(prev);
      next.set(id, movie);
      return next;
    });
    const watchDate = DateTime.now().toISO();
    setWatchedDates((prev) => new Map(prev).set(id, watchDate));
    const wasSaved = savedIds.has(id);
    if (wasSaved) {
      setSavedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setSavedMovies((prev) => { const next = new Map(prev); next.delete(id); return next; });
    }
    setCollections((prev) => prev.map((c) =>
      c.movieIds.includes(id) ? { ...c, movieIds: c.movieIds.filter((mid) => mid !== id) } : c
    ));
    // Supabase: add journal entry + cache movie
    if (user) {
      journalService.addJournalEntry(user.id, movie, { watchDate }).then((entry) => {
        if (entry) journalEntryIds.current.set(id, entry.id);
      }).catch(syncFailToast);
    }
    showToast("Moved to journal");
  };

  const setWatchedNote = (id, text) => {
    const sanitized = sanitizeText(text).slice(0, 1000);
    setWatchedNotes((prev) => new Map(prev).set(id, sanitized));
    // Supabase: update notes
    if (user) {
      const entryId = journalEntryIds.current.get(id);
      if (entryId) {
        journalService.updateJournalEntry(entryId, { notes: sanitized }).catch(syncFailToast);
      }
    }
  };

  const setWatchedRating = (id, rating) => {
    setWatchedRatings((prev) => {
      const next = new Map(prev);
      if (rating === null) next.delete(id); else next.set(id, rating);
      return next;
    });
    // Supabase: update rating
    if (user) {
      const entryId = journalEntryIds.current.get(id);
      if (entryId) {
        journalService.updateJournalEntry(entryId, { personalRating: rating }).catch(syncFailToast);
      }
    }
  };

  const createCollection = (name) => {
    const safeName = sanitizeText(name).slice(0, 50);
    if (user) {
      // Async: create in Supabase, use returned UUID as the id
      const tempId = Date.now().toString();
      setCollections((prev) => [...prev, { id: tempId, name: safeName, movieIds: [], isDefault: false }]);
      watchlistService.createCollection(user.id, safeName, false).then((col) => {
        // Replace temp id with real Supabase UUID
        setCollections((prev) => prev.map((c) => c.id === tempId ? { ...c, id: col.id } : c));
      }).catch(syncFailToast);
      return tempId;
    }
    const id = Date.now().toString();
    setCollections((prev) => [...prev, { id, name: safeName, movieIds: [], isDefault: false }]);
    return id;
  };

  const renameCollection = (collectionId, newName) => {
    const safeName = sanitizeText(newName).slice(0, 50);
    setCollections((prev) => prev.map((c) => c.id === collectionId ? { ...c, name: safeName } : c));
    if (user) {
      watchlistService.renameCollection(collectionId, safeName).catch(syncFailToast);
    }
  };

  const deleteCollection = (collectionId, afterDelete) => {
    const col = collections.find((c) => c.id === collectionId);
    if (!col || col.isDefault) return;
    Swal.fire({
      title: `Delete "${col.name}"?`,
      text: "This can't be undone.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Delete",
      confirmButtonColor: "#8B2040",
      cancelButtonText: "Cancel",
      customClass: { popup: "cinno-swal-popup" },
    }).then((result) => {
      if (result.isConfirmed) {
        setCollections((prev) => prev.filter((c) => c.id !== collectionId));
        if (user) {
          watchlistService.deleteCollection(collectionId).catch(syncFailToast);
        }
        Toast.fire({ icon: "success", title: `Deleted "${col.name}"` });
        if (afterDelete) afterDelete();
      }
    });
  };

  const toggleMovieInCollection = (collectionId, movie) => {
    // Ensure movie is in the Watchlist (savedIds/savedMovies)
    if (!savedIds.has(movie.id)) {
      setSavedIds((prev) => new Set(prev).add(movie.id));
      setSavedMovies((prev) => {
        const next = new Map(prev);
        next.set(movie.id, { ...movie, savedAt: DateTime.now().toISO() });
        return next;
      });
      // Add to Supabase Watchlist too
      if (user && watchlistIdRef.current) {
        watchlistService.addMovieToCollection(watchlistIdRef.current, movie).catch(syncFailToast);
      }
    }
    let added = false;
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      const has = c.movieIds.includes(movie.id);
      added = !has;
      return { ...c, movieIds: has ? c.movieIds.filter((id) => id !== movie.id) : [...c.movieIds, movie.id] };
    }));
    // Supabase: add or remove from collection
    if (user) {
      const has = collections.find((c) => c.id === collectionId)?.movieIds.includes(movie.id);
      if (has) {
        watchlistService.removeMovieFromCollection(collectionId, movie.id).catch(syncFailToast);
      } else {
        watchlistService.addMovieToCollection(collectionId, movie).catch(syncFailToast);
      }
    }
    if (added) {
      const col = collections.find((c) => c.id === collectionId);
      showToast(`Added to ${col?.name || "collection"}`);
    }
  };

  const startDebrief = async (movie) => {
    const rating = watchedRatings.get(movie.id);
    const notes = watchedNotes.get(movie.id);
    const opener = DEBRIEF_OPENERS[Math.floor(Math.random() * DEBRIEF_OPENERS.length)];
    const userMsg = opener(movie.title, rating, notes ? notes.trim() : null);
    const metadata = { movieContext: { title: movie.title, year: movie.year, genre: movie.genre, tmdbRating: movie.rating, synopsis: movie.synopsis } };
    const chatId = await handleCreateChat(movie.title, metadata);
    setActiveChatId(chatId);
    setActiveTab("chat");
    setDebriefPayload({ chatId, message: userMsg });
  };

  // Home → Companion handoff: optional message auto-sends once the new chat opens.
  const startCinnoChat = useCallback((message) => {
    if (isGuest) { guardAction(() => {}); return; }
    (async () => {
      const chatId = await handleCreateChat(message ? message.slice(0, 40) : "New conversation");
      setActiveChatId(chatId);
      setActiveTab("chat");
      if (message) setDebriefPayload({ chatId, message });
    })();
  }, [isGuest, guardAction, handleCreateChat, setActiveChatId, setActiveTab]);

  const goToCompanion = useCallback(() => {
    if (isGuest) { guardAction(() => {}); return; }
    setActiveTab("chat");
  }, [isGuest, guardAction, setActiveTab]);

  const goToJournal = useCallback(() => {
    setActiveTab("journal");
  }, [setActiveTab]);

  const startMoviePicker = async () => {
    // Build context from user's watchlist and journal
    const watchedList = Array.from(watchedMovies.values()).slice(-30);
    const watchedLines = watchedList.map((m) => {
      const score = watchedRatings.get(m.id);
      return `${m.title} (${m.genre}, ${m.year})${score ? ` — rated ${score}/100` : ""}`;
    });
    const savedList = Array.from(savedMovies.values()).slice(0, 15);
    const savedLines = savedList.map((m) => `${m.title} (${m.genre}, ${m.year})`);

    const pickerContext = {
      watched: watchedLines.join("; "),
      watchlist: savedLines.join("; "),
      tasteProfile: tasteProfile || "",
    };

    const chatId = await handleCreateChat("Movie Picker", { pickerMode: true, pickerContext });
    setActiveChatId(chatId);
    setActiveTab("chat");
  };

  useEffect(() => { saveToStorage("cc_savedIds",     [...savedIds]);     }, [savedIds]);
  useEffect(() => { saveToStorage("cc_savedMovies",  [...savedMovies]);  }, [savedMovies]);
  useEffect(() => { saveToStorage("cc_watchedIds",   [...watchedIds]);   }, [watchedIds]);
  useEffect(() => { saveToStorage("cc_watchedMovies",[...watchedMovies]);}, [watchedMovies]);
  useEffect(() => { saveToStorage("cc_watchedNotes",   [...watchedNotes]);   }, [watchedNotes]);
  useEffect(() => { saveToStorage("cc_watchedRatings", [...watchedRatings]); }, [watchedRatings]);
  useEffect(() => {
    saveToStorage("cc_tasteProfile", tasteProfile);
    if (user && tasteProfile !== undefined) {
      preferencesService.updateGenrePreferences(user.id, { tasteProfile }).catch(syncFailToast);
    }
  }, [tasteProfile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveToStorage("cc_collections",   collections);       }, [collections]);
  useEffect(() => { saveToStorage("cc_badges",       unlockedBadges);    }, [unlockedBadges]);
  useEffect(() => { saveToStorage("cc_watchedDates", [...watchedDates]); }, [watchedDates]);
  useEffect(() => { if (!user) saveToStorage("cc_chats", chats); }, [chats, user]);
  useEffect(() => { if (activeChatId) saveToStorage("cc_activeChatId", activeChatId); }, [activeChatId]);

  // ── Badge checking effect ──────────────────────────────────
  const badgeCelebrationQueue = useRef([]);

  const showNextCelebration = useCallback(() => {
    if (badgeCelebrationQueue.current.length === 0) return;
    const badge = badgeCelebrationQueue.current.shift();

    const tierNames = ["Bronze", "Silver", "Gold"];
    const tierName = tierNames[(badge.tierNum - 1)] || "Bronze";

    const seenKey = `${badge.id}_t${badge.tierNum}`;
    const seen = loadFromStorage("cc_badge_seen", []);
    if (!seen.includes(seenKey)) {
      saveToStorage("cc_badge_seen", [...seen, seenKey]);
    }

    Toast.fire({
      icon: "success",
      title: `🏅 ${badge.title} — ${tierName} unlocked`,
      timer: 3500,
      position: "top",
    });

    setTimeout(() => showNextCelebration(), 3800);
  }, []);

  useEffect(() => {
    const ctx = { watchedMovies, watchedRatings, collections, watchedDates, chats };
    const newlyUnlocked = [];
    BADGE_DEFS.forEach((badge) => {
      const progress = computeBadgeProgress(badge.id, ctx);
      badge.tiers.forEach((threshold, i) => {
        const tierId = `${badge.id}_t${i + 1}`;
        if (progress >= threshold && !unlockedBadges.includes(tierId)) {
          newlyUnlocked.push(tierId);
        }
      });
    });
    if (newlyUnlocked.length > 0) {
      setUnlockedBadges((prev) => [...prev, ...newlyUnlocked]);

      // Fresh device / localStorage clear: unlockedBadges was empty before this
      // run, so the entire backlog is about to "newly unlock" off Supabase
      // hydration. Silently mark them as seen so we don't cascade-toast for
      // achievements earned long ago. Real-time unlocks after this point
      // (unlockedBadges no longer empty) toast normally.
      if (unlockedBadges.length === 0) {
        const seen = loadFromStorage("cc_badge_seen", []);
        const merged = Array.from(new Set([...seen, ...newlyUnlocked]));
        saveToStorage("cc_badge_seen", merged);
        return;
      }

      const seen = loadFromStorage("cc_badge_seen", []);
      const toastBadges = new Map();
      newlyUnlocked.forEach((tierId) => {
        const badgeId = tierId.replace(/_t\d+$/, "");
        const tierNum = parseInt(tierId.slice(-1));
        if (!seen.includes(tierId) && (!toastBadges.has(badgeId) || tierNum > toastBadges.get(badgeId))) {
          toastBadges.set(badgeId, tierNum);
        }
      });
      toastBadges.forEach((tierNum, badgeId) => {
        const badge = BADGE_DEFS.find((b) => b.id === badgeId);
        if (badge) badgeCelebrationQueue.current.push({ ...badge, tierNum });
      });
      showNextCelebration();
    }
  }, [watchedMovies, watchedRatings, collections, watchedDates, unlockedBadges, showNextCelebration, chats]);
  // ── Milestone celebration check ────────────────────────────
  useEffect(() => {
    const count = watchedIds.size;
    const prev = prevWatchedCount.current;
    prevWatchedCount.current = count;
    // Only trigger when count increased (new movie added)
    if (count <= prev) return;
    const hit = MILESTONE_THRESHOLDS.find((t) => t === count);
    if (!hit) return;
    const shown = loadFromStorage("cc_shownMilestones", []);
    if (shown.includes(hit)) return;
    saveToStorage("cc_shownMilestones", [...shown, hit]);
    setActiveMilestone(hit);
  }, [watchedIds]);

  const tabs = [
    { id: "search",   label: "Home",       icon: SearchIcon    },
    { id: "discover", label: "Discover",   icon: DiscoverIcon  },
    { id: "journal",  label: "Journal",    icon: FilmStripIcon },
    { id: "saved",    label: "Watchlist",  icon: BookmarkIcon  },
    { id: "chat",     label: "Companion",  icon: ChatIcon      },
  ];

  const handleTopSearch = useCallback((q) => {
    const safe = sanitizeText(q).slice(0, 200);
    setSearchQuery(safe);
    if (safe.trim()) {
      setActiveTab("search");
    }
  }, [setActiveTab]);

  // ── Guarded actions for guest mode ──
  const guardedToggleSave = useCallback((movie) => {
    guardAction(() => toggleSave(movie));
  }, [guardAction, toggleSave]);

  const guardedToggleWatched = useCallback((movie) => {
    guardAction(() => toggleWatched(movie));
  }, [guardAction, toggleWatched]);

  const guardedCreateCollection = useCallback((name) => {
    let result;
    guardAction(() => { result = createCollection(sanitizeText(name).slice(0, 50)); });
    return result;
  }, [guardAction, createCollection]);

  const guardedToggleMovieInCollection = useCallback((collectionId, movie) => {
    guardAction(() => toggleMovieInCollection(collectionId, movie));
  }, [guardAction, toggleMovieInCollection]);

  const guardedStartDebrief = useCallback((movie) => {
    guardAction(() => startDebrief(movie));
  }, [guardAction, startDebrief]);

  const guardedStartMoviePicker = useCallback(() => {
    guardAction(() => startMoviePicker());
  }, [guardAction, startMoviePicker]);

  const guardedSetWatchedRating = useCallback((id, rating) => {
    guardAction(() => setWatchedRating(id, rating));
  }, [guardAction, setWatchedRating]);

  // Guest users get blocked from Chat tab entirely
  const handleTabClick = useCallback((tabId) => {
    if (tabId === "chat" && isGuest) {
      guardAction(() => {});
      return;
    }
    setActiveTab(tabId);
  }, [isGuest, guardAction, setActiveTab]);

  const avatarUrl = user?.user_metadata?.avatar_url;

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-brand" onClick={() => handleTabClick("search")}>
          <CinnoLogo size={28} />
          <span className="topbar-brand-text">Cinno</span>
        </div>

        <nav className="topbar-nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`topbar-nav-item ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => handleTabClick(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <span className="topbar-nav-soon" aria-disabled="true">
            Friends
            <span className="topbar-soon-badge">SOON</span>
          </span>
        </nav>

        <div className="topbar-actions">
          <div className="topbar-search">
            <span className="topbar-search-icon"><SearchIcon /></span>
            <input
              type="text"
              placeholder="Search films, people, lists..."
              value={searchQuery}
              onChange={(e) => handleTopSearch(e.target.value)}
            />
            {searchQuery && (
              <button className="topbar-search-clear" onClick={() => handleTopSearch("")}>✕</button>
            )}
          </div>
          <button className="topbar-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
            <GearIcon />
          </button>
          {user ? (
            <div className="topbar-user-wrapper" ref={userMenuRef}>
              <button className="topbar-user-btn" ref={headerMenuFloating.refs.setReference} onClick={() => setUserMenuOpen((v) => !v)}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="topbar-user-img" referrerPolicy="no-referrer" />
                ) : (
                  <div className="topbar-user-fallback"><UserIcon /></div>
                )}
              </button>
              {userMenuOpen && (
                <div className="user-dropdown" ref={headerMenuFloating.refs.setFloating} style={headerMenuFloating.floatingStyles}>
                  <button className="user-dropdown-item" onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }}>
                    <GearIcon /> Settings
                  </button>
                  <button className="user-dropdown-item user-dropdown-signout" onClick={() => { setUserMenuOpen(false); signOut(); }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="topbar-signin-btn" onClick={signInWithGoogle}>
              Sign in
            </button>
          )}
          <button className="topbar-mobile-menu-btn" onClick={() => setMobileMenuOpen(true)} title="Menu" aria-label="Open menu">
            <MenuIcon />
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-menu-header">
              <span className="mobile-menu-title">Menu</span>
              <button className="mobile-menu-close" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">✕</button>
            </div>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`mobile-menu-item ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => { handleTabClick(tab.id); setMobileMenuOpen(false); }}
              >
                <tab.icon />
                <span>{tab.label}</span>
              </button>
            ))}
            <div className="mobile-menu-item mobile-menu-soon" aria-disabled="true">
              <span>Friends</span>
              <span className="topbar-soon-badge">SOON</span>
            </div>
          </div>
        </div>
      )}

      <div className={`tab-panel ${tabFading ? "tab-fade-out" : ""} ${tabDir === "fade-in" ? "tab-fade-in" : ""}`} key={activeTab}>
        {activeTab === "search" && (
          <SearchTab
            savedIds={savedIds} toggleSave={guardedToggleSave}
            watchedIds={watchedIds} toggleWatched={guardedToggleWatched}
            startDebrief={guardedStartDebrief}
            collections={collections} toggleMovieInCollection={guardedToggleMovieInCollection}
            scrollPositions={scrollPositions}
            watchedRatings={watchedRatings} setWatchedRating={guardedSetWatchedRating}
            query={searchQuery} setQuery={setSearchQuery}
            watchedMovies={watchedMovies} watchedDates={watchedDates}
            watchedNotes={watchedNotes} setWatchedNote={setWatchedNote}
            savedMovies={savedMovies} listsLoading={listsLoading}
            goToCompanion={goToCompanion} startCinnoChat={startCinnoChat}
            goToJournal={goToJournal}
          />
        )}
        {activeTab === "saved" && (
          <SavedTab
            savedIds={savedIds} toggleSave={guardedToggleSave} savedMovies={savedMovies}
            watchedIds={watchedIds} toggleWatched={guardedToggleWatched} startDebrief={guardedStartDebrief}
            collections={collections} createCollection={guardedCreateCollection}
            renameCollection={renameCollection} deleteCollection={deleteCollection}
            toggleMovieInCollection={guardedToggleMovieInCollection}
            onStartMoviePicker={guardedStartMoviePicker}
            scrollPositions={scrollPositions}
            watchedRatings={watchedRatings} setWatchedRating={guardedSetWatchedRating}
            listsLoading={listsLoading}
          />
        )}
        {activeTab === "discover" && (
          <DiscoverTab
            savedIds={savedIds} toggleSave={guardedToggleSave}
            watchedIds={watchedIds} toggleWatched={guardedToggleWatched}
            startDebrief={guardedStartDebrief}
            collections={collections} toggleMovieInCollection={guardedToggleMovieInCollection}
            setWatchedRating={guardedSetWatchedRating}
            watchedRatings={watchedRatings}
            watchedMovies={watchedMovies}
            isGuest={isGuest}
            guardAction={guardAction}
          />
        )}
        {activeTab === "journal" && (
          <JournalTab
            watchedMovies={watchedMovies}
            watchedNotes={watchedNotes}
            setWatchedNote={setWatchedNote}
            watchedIds={watchedIds}
            toggleWatched={guardedToggleWatched}
            savedIds={savedIds}
            toggleSave={guardedToggleSave}
            watchedRatings={watchedRatings}
            setWatchedRating={guardedSetWatchedRating}
            watchedDates={watchedDates}
            tasteProfile={tasteProfile}
            onSetTasteProfile={setTasteProfile}
            startDebrief={guardedStartDebrief}
            unlockedBadges={unlockedBadges}
            collections={collections}
            scrollPositions={scrollPositions}
            chats={chats}
          />
        )}
        {activeTab === "chat" && !chatsLoading && (
          <ChatTab
            chats={chats} activeChatId={activeChatId} setActiveChatId={setActiveChatId}
            onCreateChat={handleCreateChat} onDeleteChat={handleDeleteChat}
            onRenameChat={handleRenameChat} onSaveMessage={handleSaveMessage}
            tasteProfile={tasteProfile}
            debriefPayload={debriefPayload} onDebriefHandled={() => setDebriefPayload(null)}
          />
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onClearData={requestClearAllData}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}

      <MilestoneCelebration milestone={activeMilestone} onDismiss={() => setActiveMilestone(null)} />
      {guestModal}
    </div>
  );
}
