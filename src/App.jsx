import React, { useState, useRef, useEffect, useMemo, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { getTrending, getTopRated, getSimilar, searchMovies, discoverByGenres, discoverMovies, getHiddenGems, getWatchProviders, getMovieDetails, getMovieById, getSmartContext, tmdbToMovie, IMG_BASE } from "./tmdb.js";
import { useAuth } from "./AuthContext.jsx";
import { useFloating, offset, flip, shift, autoUpdate } from "@floating-ui/react";
import { DateTime } from "luxon";
import AOS from "aos";
import "aos/dist/aos.css";
import Swal from "sweetalert2";
import * as chatService from "./services/chatService.js";
import * as preferencesService from "./services/preferencesService.js";

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

function MovieTile({ movie, onClick, isSaved, onToggleSave, className }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#7A7878";
  return (
    <div className={`movie-tile ${className || ""}`} onClick={onClick}>
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

function MovieModal({ movie, onClose, isSaved, onToggleSave, onMovieSelect, savedIds, isWatched, onToggleWatched, onStartDebrief, collections, toggleMovieInCollection }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#7A7878";
  const ratingColor = getRatingColor(movie.rating);
  const [tab, setTab] = useState("overview");
  const tabDir = useTabDirection(tab);
  const [similar, setSimilar] = useState([]);
  const [similarLoaded, setSimilarLoaded] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [providers, setProviders] = useState([]);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
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
    getWatchProviders(movie.id).then(setProviders).catch(() => {});
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

  const backdropUrl = movie.backdrop_path ? `${IMG_BASE}/w780${movie.backdrop_path}` : null;
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
            <img src={backdropUrl} alt={movie.title} />
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
                {providers.length > 0 && (
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
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const backdropUrl = movie.backdrop_path ? `${IMG_BASE}/w780${movie.backdrop_path}` : null;
  const posterBlurUrl = movie.poster_path ? `${IMG_BASE}/w342${movie.poster_path}` : null;

  useEffect(() => {
    getWatchProviders(movie.id).then(setProviders).catch(() => {});
    setDetailsLoading(true);
    getMovieDetails(movie.id).then(setDetails).catch(() => {}).finally(() => setDetailsLoading(false));
  }, [movie.id]);

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
            <img src={backdropUrl} alt={movie.title} />
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
                {providers.length > 0 && (
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

// ─── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({ savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, collections, toggleMovieInCollection, scrollPositions }) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
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
  const [gemsMovies, setGemsMovies] = useState([]);
  const [gemsLoading, setGemsLoading] = useState(true);
  const [gemsError, setGemsError] = useState(false);
  const [topRatedMovies, setTopRatedMovies] = useState([]);
  const [topRatedLoading, setTopRatedLoading] = useState(true);
  const [topRatedError, setTopRatedError] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState(null);
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
      .then((r) => { setTrendingMovies(r.movies.slice(0, 20)); setTrendingLoading(false); })
      .catch(() => { setTrendingLoading(false); setTrendingError(true); });

    setGemsLoading(true); setGemsError(false);
    const p2 = getHiddenGems(1)
      .then((r) => { setGemsMovies(r.movies.slice(0, 20)); setGemsLoading(false); })
      .catch(() => { setGemsLoading(false); setGemsError(true); });

    setTopRatedLoading(true); setTopRatedError(false);
    const p3 = getTopRated(1)
      .then((r) => { setTopRatedMovies(r.movies.slice(0, 20)); setTopRatedLoading(false); })
      .catch(() => { setTopRatedLoading(false); setTopRatedError(true); });

    return Promise.all([p1, p2, p3]);
  }, []);

  // Fetch browse sections on mount
  useEffect(() => { fetchAllSections(); }, [fetchAllSections]);

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

  const handleSearch = useCallback((q) => {
    const safeQ = sanitizeText(q).slice(0, 200);
    setQuery(safeQ);
    setSearchPage(1);
    setFetchError(false);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!safeQ.trim()) {
      setSearchResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const result = await searchMovies(safeQ, 1);
        setSearchResults(result.movies);
        setSearchTotalPages(result.totalPages || 1);
        setTimeout(() => AOS.refresh(), 50);
      } catch {
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

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
      <div className="search-container">
        <div className="search-bar">
          <span className="search-icon"><SearchIcon /></span>
          <input
            type="text"
            placeholder="Search any movie..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {query && (
            <button className="search-clear" onClick={() => { setQuery(""); setSearchResults([]); }}>✕</button>
          )}
        </div>
        {!isSearching && (
          <div className="genre-dropdown" ref={genreDropdownRef}>
            <button
              className={`genre-dropdown-trigger ${isGenreFiltered ? "active" : ""}`}
              ref={genreFloating.refs.setReference}
              onClick={() => setGenreDropdownOpen((o) => !o)}
              aria-expanded={genreDropdownOpen}
            >
              <span>{isGenreFiltered ? `Genres (${selectedGenres.length})` : "Filter by genre"}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {genreDropdownOpen && (
              <div className="genre-dropdown-panel" ref={genreFloating.refs.setFloating} style={genreFloating.floatingStyles}>
                {GENRE_FILTERS.map((g) => (
                  <button
                    key={g.id}
                    className={`genre-option ${selectedGenres.includes(g.id) ? "active" : ""}`}
                    onClick={() => toggleGenre(g.id)}
                  >
                    <span className="genre-option-check">{selectedGenres.includes(g.id) ? "✓" : ""}</span>
                    {g.label}
                  </button>
                ))}
                {isGenreFiltered && (
                  <button className="genre-clear-btn" onClick={() => { setSelectedGenres([]); setGenreDropdownOpen(false); }}>
                    Clear all
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
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
                <button className="error-card-btn" onClick={() => handleSearch(query)}>Retry</button>
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
                {heroMovies.map((movie, i) => (
                  <div key={movie.id} className={`hero-slide ${i === heroIndex ? 'active' : ''}`}>
                    {movie.backdrop_path && (
                      <img src={`${IMG_BASE}/w1280${movie.backdrop_path}`} alt="" className="hero-slide-bg" />
                    )}
                    <div className="hero-gradient" />
                    <div className="hero-content">
                      <h2 className="hero-title">{movie.title.toUpperCase()}</h2>
                      <p className="hero-subtitle">{movie.genre} · {movie.year}</p>
                      <div className="hero-actions">
                        <button className="hero-btn hero-btn-details" onClick={(e) => { e.stopPropagation(); setSelectedMovie(movie); }}>
                          More Info
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="hero-dots">
                  {Array.from({ length: Math.min(heroMovies.length, 5) }, (_, i) => {
                    const segSize = Math.ceil(heroMovies.length / Math.min(heroMovies.length, 5));
                    const isActive = Math.floor(heroIndex / segSize) === i;
                    return <button key={i} className={`hero-dot ${isActive ? 'active' : ''}`} onClick={() => setHeroIndex(i * segSize)} />;
                  })}
                </div>
              </div>
            )}

            {/* Browse Sections — stacked full-width */}
            <div className="browse-sections">
              <div className="browse-section">
                <div className="browse-section-header">
                  <div className="browse-section-title">Everyone's Watching</div>
                  <button className="desktop-refresh-btn" onClick={handleDesktopRefresh} disabled={refreshing} title="Refresh">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "spinning" : ""}>
                      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                  </button>
                </div>
                {trendingLoading ? (
                  <div className="scroll-row"><div className="scroll-row-inner"><SkeletonScrollRow /></div></div>
                ) : trendingError ? (
                  <div className="error-card compact">
                    <div className="error-card-title">Couldn't load this section</div>
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
                      />
                    ))}
                  </ScrollRow>
                )}
              </div>

              <div className="browse-section">
                <div className="browse-section-header">
                  <div className="browse-section-title">Hidden Gems</div>
                </div>
                {gemsLoading ? (
                  <div className="scroll-row"><div className="scroll-row-inner"><SkeletonScrollRow /></div></div>
                ) : gemsError ? (
                  <div className="error-card compact">
                    <div className="error-card-title">Couldn't load this section</div>
                  </div>
                ) : (
                  <ScrollRow>
                    {gemsMovies.map((movie, i) => (
                      <MovieTile
                        key={movie.id}
                        movie={{ ...movie, _idx: i }}
                        isSaved={savedIds.has(movie.id)}
                        onToggleSave={toggleSave}
                        onClick={() => setSelectedMovie(movie)}
                        className="scroll-tile"
                      />
                    ))}
                  </ScrollRow>
                )}
              </div>

              <div className="browse-section">
                <div className="browse-section-header">
                  <div className="browse-section-title">All-Time Greats</div>
                </div>
                {topRatedLoading ? (
                  <div className="scroll-row"><div className="scroll-row-inner"><SkeletonScrollRow /></div></div>
                ) : topRatedError ? (
                  <div className="error-card compact">
                    <div className="error-card-title">Couldn't load this section</div>
                  </div>
                ) : (
                  <ScrollRow>
                    {topRatedMovies.map((movie, i) => (
                      <MovieTile
                        key={movie.id}
                        movie={{ ...movie, _idx: i }}
                        isSaved={savedIds.has(movie.id)}
                        onToggleSave={toggleSave}
                        onClick={() => setSelectedMovie(movie)}
                        className="scroll-tile"
                      />
                    ))}
                  </ScrollRow>
                )}
              </div>
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
  const [selectedMovie, setSelectedMovie] = useState(null);
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

function CollectionDetailView({ collection, savedMovies, savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, onBack, onRename, onDelete, onShare, collections, toggleMovieInCollection }) {
  const [selectedMovie, setSelectedMovie] = useState(null);
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
        />
      )}
    </>
  );
}

function SavedTab({ savedIds, toggleSave, savedMovies, watchedIds, toggleWatched, startDebrief, collections, createCollection, renameCollection, deleteCollection, toggleMovieInCollection, onStartMoviePicker, scrollPositions }) {
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [emptyMsg] = useState(() => pickRandom(EMPTY_WATCHLIST));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeCollection, setActiveCollection] = useState(null);
  const [watchlistView, setWatchlistView] = useState("grid");
  const [upNextId, setUpNextId] = useState(() => loadFromStorage("cc_upNextId", null));
  const savedContentRef = useScrollRestore("saved", scrollPositions);

  const movies = useMemo(
    () => Array.from(savedMovies.values()).map((m, i) => ({ ...m, _idx: i })),
    [savedMovies]
  );

  // Up Next logic: persist pick, default to oldest movie in watchlist
  const upNextMovie = useMemo(() => {
    if (movies.length === 0) return null;
    // If stored pick is still in watchlist, use it
    if (upNextId && savedMovies.has(upNextId)) return savedMovies.get(upNextId);
    // Otherwise pick the first (oldest added) movie
    return movies[0] || null;
  }, [movies, upNextId, savedMovies]);

  const shuffleUpNext = () => {
    if (movies.length <= 1) return;
    const others = movies.filter((m) => m.id !== (upNextMovie?.id));
    if (others.length === 0) return;
    const pick = others[Math.floor(Math.random() * others.length)];
    setUpNextId(pick.id);
    saveToStorage("cc_upNextId", pick.id);
  };

  // Clear stored pick if it was removed from watchlist
  useEffect(() => {
    if (upNextId && !savedMovies.has(upNextId)) {
      setUpNextId(null);
      removeFromStorage("cc_upNextId");
    }
  }, [upNextId, savedMovies]);

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
      />
    );
  }

  return (
    <>
      <div className="content" ref={savedContentRef}>
        {/* Up Next Banner — immersive backdrop */}
        {upNextMovie ? (
          <div className="upnext-banner" onClick={() => setSelectedMovie(upNextMovie)}>
            <div className="upnext-banner-backdrop">
              {(upNextMovie.backdrop_path || upNextMovie.poster_path) && (
                <img
                  src={`${IMG_BASE}/w1280${upNextMovie.backdrop_path || upNextMovie.poster_path}`}
                  alt=""
                  className="upnext-banner-img"
                />
              )}
            </div>
            <div className="upnext-banner-gradient" />
            <div className="upnext-banner-content">
              <div className="upnext-banner-poster">
                <PosterImage posterPath={upNextMovie.poster_path} title={upNextMovie.title} />
              </div>
              <div className="upnext-banner-info">
                <div className="upnext-banner-label">Up Next</div>
                <div className="upnext-banner-title">{upNextMovie.title}</div>
                <div className="upnext-banner-meta">{upNextMovie.genre} · {upNextMovie.year}</div>
                {upNextMovie.savedAt && <div className="upnext-banner-added">{formatAddedDate(upNextMovie.savedAt)}</div>}
                <div className="upnext-banner-prompt">Watch tonight?</div>
                <div className="upnext-banner-actions">
                  <button className="upnext-banner-details-btn" onClick={(e) => { e.stopPropagation(); setSelectedMovie(upNextMovie); }}>More Info</button>
                  <button className="upnext-banner-shuffle-btn" onClick={(e) => { e.stopPropagation(); shuffleUpNext(); }} title="Pick a different movie">
                    <ShuffleIcon size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {movies.length === 0 ? (
          <div className="saved-empty">
            <div className="saved-icon">{emptyMsg.icon}</div>
            <div className="saved-title">{emptyMsg.title}</div>
            <div className="saved-desc">{emptyMsg.desc}</div>
          </div>
        ) : (
          <>
            <div className="watchlist-header-row" data-aos="fade-right" data-aos-duration="300">
              <div className="watchlist-title-row">
                <span className="watchlist-title">Watchlist</span>
                <span className="watchlist-count-pill">{movies.length}</span>
              </div>
              <button
                className="watchlist-view-toggle"
                onClick={() => setWatchlistView((v) => v === "grid" ? "list" : "grid")}
                title={watchlistView === "grid" ? "Switch to list" : "Switch to grid"}
              >
                {watchlistView === "grid" ? <ListIcon /> : <GridIcon />}
              </button>
            </div>
            {watchlistView === "grid" ? (
              <div className="movies-grid" data-aos="fade-up" data-aos-duration="400">
                {movies.map((movie) => (
                  <MovieTile
                    key={movie.id}
                    movie={movie}
                    isSaved={true}
                    onToggleSave={toggleSave}
                    onClick={() => setSelectedMovie(movie)}
                  />
                ))}
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
          </>
        )}

        {/* Collections — compact pill chips */}
        {collections.length > 0 && (
          <div className="collections-chips-section">
            <div className="collections-chips-header" data-aos="fade-right" data-aos-duration="300">
              <span className="collections-chips-title">Collections</span>
            </div>
            <div className="collections-chips-row">
              {collections.map((col) => (
                <button
                  key={col.id}
                  className="collection-chip"
                  onClick={() => setActiveCollection(col.id)}
                >
                  <span className="collection-chip-name">{col.name}</span>
                  <span className="collection-chip-count">{col.movieIds.length}</span>
                </button>
              ))}
              <button className="collection-chip collection-chip-add" onClick={() => setShowCreateModal(true)} title="New collection">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <span className="collection-chip-name">New</span>
              </button>
            </div>
          </div>
        )}
        {collections.length === 0 && (
          <div className="collections-chips-section">
            <div className="collections-chips-row">
              <button className="collection-chip collection-chip-add" onClick={() => setShowCreateModal(true)} title="New collection">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                <span className="collection-chip-name">Create a collection</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Movie Picker FAB */}
      <button className="movie-picker-fab" onClick={onStartMoviePicker} title="Movie Picker">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <path d="M20 3v4" /><path d="M22 5h-4" />
        </svg>
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

// ─── Stats View (Bento Magazine Grid) ──────────────────────────────────────────

const IDENTITY_MAP = {
  Action: "The Thrill Seeker", Thriller: "The Thrill Seeker",
  Drama: "The Deep Feeler", "Sci-Fi": "The Visionary",
  Horror: "The Edge Walker", Comedy: "The Mood Lifter",
  Animation: "The Young at Heart", Romance: "The Romantic Soul",
  Documentary: "The Truth Seeker", Fantasy: "The Daydreamer",
  Adventure: "The Explorer", Mystery: "The Puzzle Chaser",
};

function StatsView({ watchedMovies, watchedRatings, watchedDates, collections, chats }) {
  const { user } = useAuth();
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [runtimeCache, setRuntimeCache] = useState(() => loadFromStorage("cc_runtimeCache", {}));
  const [showcaseIds, setShowcaseIds] = useState(() => loadFromStorage("cc_badge_showcase", []));
  const [flippedBadges, setFlippedBadges] = useState(new Set());

  // Sync showcaseIds from Supabase on login
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    preferencesService.getPreferences(user.id).then((prefs) => {
      if (cancelled) return;
      const remote = prefs.ui_toggles?.badgeShowcase;
      if (Array.isArray(remote) && remote.length > 0) {
        setShowcaseIds(remote);
        saveToStorage("cc_badge_showcase", remote);
      }
    });
    return () => { cancelled = true; };
  }, [user]);

  // Fetch runtimes for movies missing from the cache
  useEffect(() => {
    const missing = [];
    watchedMovies.forEach((movie, id) => {
      if (runtimeCache[id] === undefined) missing.push(id);
    });
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      // Fetch in small batches to avoid hammering the API
      for (let i = 0; i < missing.length; i++) {
        if (cancelled) return;
        try {
          const details = await getMovieDetails(missing[i]);
          updates[missing[i]] = details?.runtime || 120;
        } catch {
          updates[missing[i]] = 120;
        }
      }
      if (cancelled) return;
      setRuntimeCache((prev) => {
        const next = { ...prev, ...updates };
        saveToStorage("cc_runtimeCache", next);
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [watchedMovies]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const totalMovies = watchedMovies.size;
    let totalMinutes = 0;
    watchedMovies.forEach((movie, id) => {
      totalMinutes += runtimeCache[id] || 120;
    });
    const totalHours = Math.round(totalMinutes / 60);
    const avgRating = watchedRatings.size > 0
      ? Math.round([...watchedRatings.values()].reduce((s, v) => s + v, 0) / watchedRatings.size)
      : 0;

    const ratedMovies = [...watchedRatings.entries()]
      .map(([id, score]) => ({ movie: watchedMovies.get(id), score }))
      .filter((e) => e.movie)
      .sort((a, b) => b.score - a.score);
    const top3 = ratedMovies.slice(0, 3);
    const lowest = ratedMovies.length > 1 ? ratedMovies[ratedMovies.length - 1] : null;

    const genreCounts = {};
    watchedMovies.forEach((movie) => {
      const genre = movie.genre || "Other";
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });
    const genres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    return { totalMovies, totalHours, avgRating, genreCount: genres.length, top3, lowest, genres };
  }, [watchedMovies, watchedRatings, runtimeCache]);

  if (stats.totalMovies === 0) {
    return <div className="rankings-empty">Watch some movies to see your stats here.</div>;
  }

  const topGenre = stats.genres[0]?.name || "Film";
  const identity = IDENTITY_MAP[topGenre] || "The Eclectic Explorer";
  const topThreeGenres = stats.genres.slice(0, 3);

  const badgesWithTier = useMemo(() => {
    const ctx = { watchedMovies, watchedRatings, collections: collections || [], watchedDates: watchedDates || new Map(), chats: chats || [] };
    return BADGE_DEFS.map((b) => {
      const progress = computeBadgeProgress(b.id, ctx);
      const tier = getBadgeTier(progress, b.tiers);
      return { ...b, progress, tier };
    });
  }, [watchedMovies, watchedRatings, collections, watchedDates]);

  const showcaseBadges = useMemo(() => {
    if (showcaseIds.length > 0) {
      const selected = showcaseIds.map((id) => badgesWithTier.find((b) => b.id === id)).filter(Boolean).filter((b) => b.tier > 0);
      if (selected.length > 0) return selected.slice(0, 3);
    }
    return badgesWithTier.filter((b) => b.tier > 0).sort((a, b) => b.tier - a.tier).slice(0, 3);
  }, [badgesWithTier, showcaseIds]);

  const toggleShowcase = useCallback((badgeId) => {
    setShowcaseIds((prev) => {
      const next = prev.includes(badgeId) ? prev.filter((id) => id !== badgeId) : [...prev.filter((id) => id !== badgeId), badgeId].slice(-3);
      saveToStorage("cc_badge_showcase", next);
      if (user) preferencesService.updateUIToggles(user.id, { badgeShowcase: next });
      return next;
    });
  }, [user]);

  const toggleFlip = useCallback((badgeId) => {
    setFlippedBadges((prev) => {
      const next = new Set(prev);
      next.has(badgeId) ? next.delete(badgeId) : next.add(badgeId);
      return next;
    });
  }, []);

  return (
    <div className="bento-stats">
      {/* Share button */}
      <button className="bento-share-btn" onClick={() => Toast.fire({ icon: "info", title: "Share feature coming soon" })} title="Share stats">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>

      {/* CARD 1 — MOVIE IDENTITY */}
      <div className="bento-card bento-identity" style={{ '--delay': '0' }}>
        <div className="bento-identity-content">
          <div className="bento-identity-label">Your Movie Identity</div>
          <div className="bento-identity-title">{identity}</div>
          <div className="bento-identity-genres">
            {topThreeGenres.map((g) => (
              <span key={g.name} className="bento-genre-pill" style={{ background: `${GENRE_COLORS[g.name] || "#7A7878"}25`, color: GENRE_COLORS[g.name] || "#7A7878" }}>{g.name}</span>
            ))}
          </div>
        </div>
      </div>

      {/* CARD 2 — TOP FILM (#1 rated) */}
      <div className="bento-card bento-top-film" style={{ '--delay': '1' }}>
        {stats.top3[0]?.movie?.poster_path ? (
          <>
            <img src={`${IMG_BASE}/w500${stats.top3[0].movie.poster_path}`} alt="" className="bento-film-bg" />
            <div className="bento-film-overlay" />
            <div className="bento-film-content">
              <div className="bento-film-badge">#1 Film</div>
              <div className="bento-film-title">{stats.top3[0].movie.title}</div>
              <div className="bento-film-meta">{stats.top3[0].movie.year}</div>
              <ScoreRing score={stats.top3[0].score} size={48} />
            </div>
          </>
        ) : (
          <div className="bento-film-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}>
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" /><line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="17" x2="22" y2="17" /><line x1="17" y1="7" x2="22" y2="7" />
            </svg>
            <span>Rate movies to see your #1</span>
          </div>
        )}
      </div>

      {/* CARD 3 — MOVIES WATCHED */}
      <div className="bento-card bento-stat bento-stat-a" style={{ '--delay': '2' }}>
        <div className="bento-stat-number">{stats.totalMovies}</div>
        <div className="bento-stat-label">movies</div>
      </div>

      {/* CARD 4 — HOURS OF CINEMA */}
      <div className="bento-card bento-stat bento-stat-b bento-hours" style={{ '--delay': '3' }}>
        <div className="bento-stat-number">{stats.totalHours}h</div>
        <div className="bento-stat-label">watched</div>
      </div>

      {/* CARD 5 — #2 FILM */}
      <div className="bento-card bento-film-small bento-film-2" style={{ '--delay': '4' }}>
        {stats.top3[1]?.movie?.poster_path ? (
          <>
            <img src={`${IMG_BASE}/w342${stats.top3[1].movie.poster_path}`} alt="" className="bento-film-bg" />
            <div className="bento-film-overlay" />
            <div className="bento-film-content">
              <div className="bento-film-badge">#2</div>
              <div className="bento-film-title bento-film-title-sm">{stats.top3[1].movie.title}</div>
              <ScoreRing score={stats.top3[1].score} size={36} />
            </div>
          </>
        ) : (
          <div className="bento-film-empty"><span>#2</span></div>
        )}
      </div>

      {/* CARD 6 — #3 FILM */}
      <div className="bento-card bento-film-small bento-film-3" style={{ '--delay': '5' }}>
        {stats.top3[2]?.movie?.poster_path ? (
          <>
            <img src={`${IMG_BASE}/w342${stats.top3[2].movie.poster_path}`} alt="" className="bento-film-bg" />
            <div className="bento-film-overlay" />
            <div className="bento-film-content">
              <div className="bento-film-badge">#3</div>
              <div className="bento-film-title bento-film-title-sm">{stats.top3[2].movie.title}</div>
              <ScoreRing score={stats.top3[2].score} size={36} />
            </div>
          </>
        ) : (
          <div className="bento-film-empty"><span>#3</span></div>
        )}
      </div>

      {/* CARD 7 — AVG RATING */}
      <div className="bento-card bento-stat bento-avg" style={{ '--delay': '6' }}>
        <ScoreRing score={stats.avgRating} size={56} />
        <div className="bento-stat-label">average score</div>
      </div>

      {/* CARD 8 — GENRES EXPLORED */}
      <div className="bento-card bento-stat bento-stat-b bento-genres" style={{ '--delay': '7' }}>
        <div className="bento-stat-number">{stats.genreCount}</div>
        <div className="bento-stat-label">genres</div>
      </div>

      {/* CARD 9 — ACHIEVEMENTS */}
      <div className="bento-card bento-achievements" style={{ '--delay': '8' }}>
        <div className="bento-achievements-row">
          {[0, 1, 2].map((i) => {
            const badge = showcaseBadges[i];
            if (!badge) return <div key={i} className="bento-badge-empty" />;
            const tierKey = ["bronze", "silver", "gold"][badge.tier - 1];
            const tierColor = TIER_COLORS[tierKey];
            const Icon = badge.icon;
            return (
              <div key={badge.id} className="bento-badge-slot" data-tier={tierKey}>
                {showcaseIds.includes(badge.id) && <div className="bento-badge-star">★</div>}
                <div className="bento-badge-glow" style={{ background: tierColor }} />
                <div className="bento-badge-icon" style={{ color: tierColor }}><Icon /></div>
                <div className="bento-badge-name">{badge.title}</div>
                <div className="bento-badge-tier" style={{ color: tierColor }}>{TIER_NAMES[badge.tier]}</div>
              </div>
            );
          })}
        </div>
        <button className="bento-see-all" onClick={() => setShowAllBadges(!showAllBadges)}>
          {showAllBadges ? "Hide badges" : "See all →"}
        </button>
        {showAllBadges && (
          <div className="badge-grid-inline" style={{ marginTop: 12 }}>
            {badgesWithTier.map((badge) => {
              const { progress, tier, secret } = badge;
              const isHiddenSecret = secret && tier === 0;
              const tierColor = tier > 0 ? TIER_COLORS[["bronze", "silver", "gold"][tier - 1]] : null;
              const nextTier = Math.min(tier + 1, 3);
              const nextTarget = badge.tiers[nextTier - 1];
              const prevTarget = tier > 0 ? badge.tiers[tier - 1] : 0;
              const pct = tier >= 3 ? 100 : Math.min(((progress - prevTarget) / (nextTarget - prevTarget)) * 100, 100);
              const Icon = badge.icon;
              const isFlipped = flippedBadges.has(badge.id);
              const rarity = tier > 0 ? BADGE_RARITY[badge.id]?.[tier] : null;

              return (
                <div key={badge.id} className={`badge-flip-container ${isFlipped ? "flipped" : ""}`} onClick={() => toggleFlip(badge.id)}>
                  {/* FRONT */}
                  <div className={`badge-flip-front badge-inline ${tier > 0 ? "unlocked" : "locked"}`}>
                    <div className="badge-inline-icon" style={tierColor ? { color: tierColor } : undefined}>
                      {tier > 0 && <div className="badge-tier-ring" style={{ borderColor: tierColor, boxShadow: tier === 3 ? `0 0 8px ${tierColor}44` : "none" }} />}
                      {tier === 0 && <div className="badge-inline-lock"><LockIcon /></div>}
                      {isHiddenSecret ? (
                        <svg viewBox="0 0 40 40" fill="none"><text x="20" y="25" textAnchor="middle" fill="currentColor" fontSize="18" fontWeight="700">?</text></svg>
                      ) : (
                        <Icon />
                      )}
                    </div>
                    <div className="badge-inline-name">{isHiddenSecret ? "???" : badge.title}</div>
                    {tier > 0 && <div className="badge-tier-label" style={{ color: tierColor }}>{TIER_NAMES[tier]}</div>}
                    <div className="badge-inline-progress">
                      <div className="badge-inline-track">
                        <div className="badge-inline-fill" style={{ width: `${isHiddenSecret ? 0 : pct}%`, background: tierColor || undefined }} />
                      </div>
                      {!isHiddenSecret && <span className="badge-inline-frac">{progress}/{tier >= 3 ? badge.tiers[2] : nextTarget}</span>}
                    </div>
                  </div>
                  {/* BACK */}
                  <div className="badge-flip-back">
                    {isHiddenSecret ? (
                      <div className="badge-back-secret">
                        <div className="badge-back-q">???</div>
                        <div className="badge-back-hint">{SECRET_HINTS[badge.id] || "Keep exploring..."}</div>
                      </div>
                    ) : tier > 0 ? (
                      <div className="badge-back-unlocked">
                        <div className="badge-back-earned">Earned by</div>
                        <div className="badge-back-desc">{badge.desc}</div>
                        {rarity && (
                          <div className="badge-rarity-tag" style={{ background: rarity.color + "22", color: rarity.color }}>
                            {rarity.label} — {rarity.pct}%
                          </div>
                        )}
                        {tier < 3 && <div className="badge-back-next">Next: {nextTarget} for {TIER_NAMES[tier + 1]}</div>}
                        <button className="badge-showcase-btn" onClick={(e) => { e.stopPropagation(); toggleShowcase(badge.id); }}>
                          {showcaseIds.includes(badge.id) ? "★ In Showcase" : "Set as Showcase"}
                        </button>
                      </div>
                    ) : (
                      <div className="badge-back-locked">
                        <div className="badge-back-earned">To unlock</div>
                        <div className="badge-back-desc">{badge.desc}: {badge.tiers[0]}</div>
                        <div className="badge-back-remaining">{badge.tiers[0] - progress} more to go</div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CARD 10 — BEST VS WORST */}
      {stats.top3[0] && stats.lowest && stats.top3[0].movie.id !== stats.lowest.movie.id && (
        <div className="bento-card bento-vs" style={{ '--delay': '9' }}>
          <div className="bento-vs-half bento-vs-best">
            <div className="bento-vs-poster">
              <PosterImage posterPath={stats.top3[0].movie.poster_path} title={stats.top3[0].movie.title} />
            </div>
            <div className="bento-vs-info">
              <div className="bento-vs-tag best">Best</div>
              <div className="bento-vs-name">{stats.top3[0].movie.title}</div>
            </div>
            <ScoreRing score={stats.top3[0].score} size={34} />
          </div>
          <div className="bento-vs-center">VS</div>
          <div className="bento-vs-half bento-vs-worst">
            <div className="bento-vs-poster">
              <PosterImage posterPath={stats.lowest.movie.poster_path} title={stats.lowest.movie.title} />
            </div>
            <div className="bento-vs-info">
              <div className="bento-vs-tag worst">Worst</div>
              <div className="bento-vs-name">{stats.lowest.movie.title}</div>
            </div>
            <ScoreRing score={stats.lowest.score} size={34} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Journal Tab ───────────────────────────────────────────────────────────────

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
  const { user } = useAuth();
  const [selectedMovie, setSelectedMovie] = useState(null);
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
  const [rankSort, setRankSort] = useState(() => {
    const stored = loadFromStorage("cc_rankSort", "rating_desc");
    return RANK_SORT_OPTIONS.some((o) => o.value === stored) ? stored : "rating_desc";
  });
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
      if (t?.rankSort && RANK_SORT_OPTIONS.some((o) => o.value === t.rankSort)) setRankSort(t.rankSort);
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
      const resp = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    saveToStorage("cc_rankSort", rankSort);
    if (user) preferencesService.updateUIToggles(user.id, { rankSort });
  }, [rankSort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    saveToStorage("cc_journalSort", journalSort);
    if (user) preferencesService.updateUIToggles(user.id, { journalSort });
  }, [journalSort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { saveToStorage("cc_runtimeCache", runtimeCache); }, [runtimeCache]);

  // Fetch runtimes when runtime sort is active
  const runtimeFetchedRef = useRef(false);
  useEffect(() => {
    const needsRuntime = rankSort === "runtime_desc" || journalSort === "runtime_desc";
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
  }, [rankSort, journalSort, movies, runtimeCache]);

  // Reset fetch guard when sort changes away from runtime
  useEffect(() => {
    if (rankSort !== "runtime_desc" && journalSort !== "runtime_desc") {
      runtimeFetchedRef.current = false;
    }
  }, [rankSort, journalSort]);

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
  const rankedMovies = useMemo(() => {
    const rated = movies.filter((m) => watchedRatings.has(m.id));
    return sortMovies(rated, rankSort);
  }, [movies, watchedRatings, rankSort, sortMovies]);

  const sortedJournalMovies = useMemo(
    () => sortMovies(movies, journalSort),
    [movies, journalSort, sortMovies]
  );

  const filteredJournalMovies = useMemo(() => {
    if (!journalSearch.trim()) return sortedJournalMovies;
    const q = journalSearch.trim().toLowerCase();
    return sortedJournalMovies.filter((m) => (m.title || "").toLowerCase().includes(q));
  }, [sortedJournalMovies, journalSearch]);

  const rankingStats = useMemo(() => {
    if (rankedMovies.length === 0) return null;
    const total = rankedMovies.length;
    const avg = Math.round(rankedMovies.reduce((s, m) => s + (watchedRatings.get(m.id) || 0), 0) / total);
    const genreCounts = {};
    rankedMovies.forEach((m) => { genreCounts[m.genre || "Other"] = (genreCounts[m.genre || "Other"] || 0) + 1; });
    const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    return { total, avg, topGenre };
  }, [rankedMovies, watchedRatings]);

  const TOGGLE_VIEWS = ["journal", "rankings", "stats"];
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
            {view === "rankings" && (
              <>
                <div className="saved-icon">{emptyRankings.icon}</div>
                <div className="saved-title">{emptyRankings.title}</div>
                <div className="saved-desc">{emptyRankings.desc}</div>
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
                {/* Unified toolbar card */}
                <div className="journal-header-card" data-aos="fade-right" data-aos-duration="300">
                  <div className="journal-header-top">
                    <div className="journal-header-title">Your Journal</div>
                    <div className="journal-header-count">{filteredJournalMovies.length} watched</div>
                  </div>
                  <div className="journal-header-bottom">
                    <div className="journal-header-search">
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
                  </div>
                </div>
                {filteredJournalMovies.length === 0 && journalSearch.trim() ? (
                  <div className="journal-no-results">No movies found</div>
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
                        <div className="journal-genre-header" data-aos="fade-right" data-aos-duration="300" style={{ color: GENRE_COLORS[genre] || "var(--text-secondary)" }}>{genre}</div>
                        <div className="movies-grid" data-aos="fade-up" data-aos-duration="400">
                          {gMovies.map((movie) => (
                            <MovieTile
                              key={movie.id}
                              movie={movie}
                              isSaved={savedIds.has(movie.id)}
                              onToggleSave={toggleSave}
                              onClick={() => setSelectedMovie(movie)}
                            />
                          ))}
                        </div>
                      </div>
                    ));
                  })()
                ) : (
                  <div className="movies-grid" data-aos="fade-up" data-aos-duration="400">
                    {filteredJournalMovies.map((movie) => (
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
              </>
            )}

            {view === "rankings" && (
              <>
                {rankedMovies.length === 0 ? (
                  <div className="rankings-empty">Rate movies in your journal to see them ranked here.</div>
                ) : (
                  <>
                    {/* Stat Row + Sort */}
                    <div className="rank-stat-row" data-aos="fade-right" data-aos-duration="300">
                      <div className="rank-stat-text">
                        {rankingStats && (
                          <>
                            <strong>{rankingStats.total}</strong> rated
                            <span className="rank-stat-dot" />
                            <span>Avg </span><strong>{rankingStats.avg}</strong>/100
                            <span className="rank-stat-dot" />
                            <span>Top: </span><strong>{rankingStats.topGenre}</strong>
                          </>
                        )}
                      </div>
                      <SortDropdown options={RANK_SORT_OPTIONS} value={rankSort} onChange={setRankSort} />
                    </div>

                    {/* Podium — Top 3 */}
                    {rankSort === "rating_desc" && rankedMovies.length >= 3 && (
                      <div className="podium-v2" data-aos="fade-up" data-aos-duration="500">
                        {[1, 0, 2].map((idx) => {
                          const m = rankedMovies[idx];
                          const isFirst = idx === 0;
                          const medalColor = idx === 0 ? "#C9A84C" : idx === 1 ? "#B0B0B0" : "#B87333";
                          return (
                            <div key={m.id} className={`podium-v2-slot ${isFirst ? "podium-v2-first" : ""}`} onClick={() => setSelectedMovie(m)}>
                              <div className="podium-v2-poster-wrap">
                                <div className={`podium-v2-poster ${isFirst ? "podium-v2-poster-lg" : ""}`}>
                                  <PosterImage posterPath={m.poster_path} title={m.title} />
                                </div>
                                <div className="podium-v2-badge" style={{ background: medalColor }}>{idx + 1}</div>
                              </div>
                              <div className="podium-v2-title">{m.title}</div>
                              <ScoreRing score={watchedRatings.get(m.id)} size={isFirst ? 40 : 34} />
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Ranking List #4+ */}
                    <div className="rankings-list">
                      {(rankSort === "rating_desc" && rankedMovies.length >= 3 ? rankedMovies.slice(3) : rankedMovies).map((movie, i) => {
                        const rank = rankSort === "rating_desc" && rankedMovies.length >= 3 ? i + 4 : i + 1;
                        return (
                          <div key={movie.id} className="ranking-item" onClick={() => setSelectedMovie(movie)} data-aos={i < 10 ? "fade-up" : undefined} data-aos-duration={i < 10 ? "300" : undefined} data-aos-delay={i < 10 ? `${i * 30}` : undefined}>
                            <span className="ranking-num">{rank}</span>
                            <div className="ranking-poster">
                              <PosterImage posterPath={movie.poster_path} title={movie.title} />
                            </div>
                            <div className="ranking-info">
                              <div className="ranking-title">{movie.title}</div>
                              <div className="ranking-meta">{movie.genre} · {movie.year}{watchedDates.get(movie.id) ? ` · ${formatWatchDate(watchedDates.get(movie.id))}` : ""}</div>
                            </div>
                            <ScoreRing score={watchedRatings.get(movie.id)} size={36} />
                          </div>
                        );
                      })}
                    </div>

                    {insight && !insightLoading && movies.length >= 3 && (
                      <div className="insight-banner" style={{ marginTop: 16 }}>
                        <span className="insight-banner-icon">{INSIGHT_ICONS[insight.type]}</span>
                        <span className="insight-banner-label">{INSIGHT_LABELS[insight.type]}</span>
                        <span className="insight-banner-text">{insight.text}</span>
                        <button className="insight-banner-refresh" onClick={refreshInsight} title="New insight">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </>
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

      {/* Floating Toggle Pill — portaled to body to escape overflow/transform clipping */}
      {createPortal(
        <div className="journal-float-toggle">
          <div className="journal-float-toggle-track" style={{ transform: `translateX(${toggleIndex * 100}%)` }} />
          <button className={`journal-float-toggle-btn ${view === "journal" ? "active" : ""}`} onClick={() => setView("journal")}>Journal</button>
          <button className={`journal-float-toggle-btn ${view === "rankings" ? "active" : ""}`} onClick={() => setView("rankings")}>Rankings</button>
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
  const { user } = useAuth();
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
      if (user) preferencesService.updateUIToggles(user.id, { smartMode: next });
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
          const resp = await fetch(`${API_URL}/api/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchQuery }),
          });
          if (resp.ok) {
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
      const resp = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      const resp = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

function BadgeUnlockCelebration({ badge, onDismiss }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    if (!badge) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const tierNum = badge.tierNum || 1;
    const tierKey = ["bronze", "silver", "gold"][tierNum - 1];
    const baseColor = TIER_COLORS[tierKey] || TIER_COLORS.bronze;
    const r = parseInt(baseColor.slice(1, 3), 16);
    const g = parseInt(baseColor.slice(3, 5), 16);
    const b = parseInt(baseColor.slice(5, 7), 16);

    const particles = [];
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 40;
    for (let i = 0; i < 60; i++) {
      const angle = (Math.PI * 2 * i) / 60 + (Math.random() - 0.5) * 0.5;
      const speed = 2 + Math.random() * 5;
      const lightness = 0.6 + Math.random() * 0.4;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        size: 2 + Math.random() * 4,
        color: `rgba(${Math.round(r * lightness)}, ${Math.round(g * lightness)}, ${Math.round(b * lightness)}, `,
        life: 0.7 + Math.random() * 0.3,
        decay: 0.012 + Math.random() * 0.008,
      });
    }

    const start = performance.now();
    function draw(now) {
      const elapsed = (now - start) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (elapsed < 0.8) {
        // Glowing orb phase
        const orbProgress = Math.min(elapsed / 0.6, 1);
        const orbSize = 20 + orbProgress * 15;
        const pulse = 1 + Math.sin(elapsed * 12) * 0.15;
        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbSize * pulse * 2);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.8 * (1 - elapsed / 0.8)})`);
        gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${0.3 * (1 - elapsed / 0.8)})`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, orbSize * pulse * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (elapsed > 0.5) {
        // Particle burst phase
        particles.forEach((p) => {
          if (p.life <= 0) return;
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.08;
          p.vx *= 0.98;
          p.life -= p.decay;
          ctx.fillStyle = p.color + Math.max(p.life, 0) + ")";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * Math.max(p.life, 0.1), 0, Math.PI * 2);
          ctx.fill();
        });
      }
      if (elapsed < 2.5) {
        animRef.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    animRef.current = requestAnimationFrame(draw);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [badge]);

  if (!badge) return null;
  const tierNum = badge.tierNum || 1;
  const tierName = TIER_NAMES[tierNum] || "Bronze";
  const tierColor = TIER_COLORS[["bronze", "silver", "gold"][tierNum - 1]] || TIER_COLORS.bronze;
  const Icon = badge.icon;

  return createPortal(
    <div className="badge-unlock-overlay" onClick={onDismiss}>
      <canvas ref={canvasRef} className="badge-unlock-canvas" />
      <div className="badge-unlock-content">
        <div className="badge-unlock-icon-wrap" style={{ '--tier-color': tierColor }}>
          <div className="badge-unlock-icon" style={{ color: tierColor }}><Icon /></div>
        </div>
        <div className="badge-unlock-label">UNLOCKED</div>
        <div className="badge-unlock-title">{badge.title}</div>
        <div className="badge-unlock-tier" style={{ color: tierColor }}>{tierName}</div>
        <div className="badge-unlock-desc">{badge.desc}</div>
        <div className="badge-unlock-hint">Tap anywhere to dismiss</div>
      </div>
    </div>,
    document.body
  );
}

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

const RANK_SORT_OPTIONS = [
  { value: "rating_desc", label: "My ranking (high to low)" },
  { value: "tmdb_desc", label: "TMDB rating (high to low)" },
  { value: "tmdb_asc", label: "TMDB rating (low to high)" },
  { value: "year_desc", label: "Release year (newest)" },
  { value: "year_asc", label: "Release year (oldest)" },
  { value: "date_desc", label: "Date watched (recent)" },
  { value: "runtime_desc", label: "Runtime (longest)" },
  { value: "alpha_asc", label: "Alphabetical (A-Z)" },
];

const JOURNAL_SORT_OPTIONS = [
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

  const { refs, floatingStyles } = useFloating({
    open,
    placement: "bottom-end",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel = options.find((o) => o.value === value)?.label || "";

  return (
    <div className="sort-dropdown" ref={wrapRef}>
      <button className="sort-dropdown-btn" ref={refs.setReference} onClick={() => setOpen(!open)}>
        <span className="sort-dropdown-label">{activeLabel}</span>
        <svg className={`sort-dropdown-chevron${open ? " open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>
      {open && (
        <div className="sort-dropdown-menu" ref={refs.setFloating} style={floatingStyles}>
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

function DiscoverTab({ savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, collections, toggleMovieInCollection, setWatchedRating, watchedMovies, isGuest, guardAction }) {
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
  const [selectedMovie, setSelectedMovie] = useState(null);
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

  // Sync maybeLater from Supabase on login
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    preferencesService.getPreferences(user.id).then((prefs) => {
      if (cancelled) return;
      const remote = prefs.genre_preferences?.discoverMaybeLater;
      if (Array.isArray(remote) && remote.length > 0) {
        setMaybeLater(remote);
        saveToStorage("cc_discover_maybe_later", remote);
      }
    });
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
    if (user) preferencesService.updateGenrePreferences(user.id, { discoverMaybeLater: maybeLater });
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

  const loadMovies = async (genreIds = [], append = false) => {
    const version = ++fetchVersionRef.current;

    if (!append) {
      setLoading(true);
      setSwipeCount(0);
      setUndoHistory([]);
    }

    try {
      const apiKey = import.meta.env.VITE_TMDB_API_KEY;
      let baseUrl = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&vote_average.gte=6.5&vote_count.gte=100&with_original_language=en&sort_by=popularity.desc&primary_release_date.gte=${releaseDateGte}`;
      if (genreIds.length > 0) {
        baseUrl += `&with_genres=${genreIds.join("|")}`;
      }

      // Probe page 1 first to discover total_pages, so we don't request beyond available range
      let maxPage = 500; // TMDB hard cap
      try {
        const probeRes = await fetch(`${baseUrl}&page=1`);
        if (probeRes.ok) {
          const probeData = await probeRes.json();
          maxPage = Math.min(probeData.total_pages || 1, 500);
        }
      } catch {
        // fallback to default maxPage
      }

      const genreIdSet = new Set(genreIds);
      for (let attempt = 0; attempt < 3; attempt++) {
        // Pick a random page within the actual available range (leave room for page+1 fetch)
        const pageLimit = Math.max(1, maxPage - 1);
        const page = Math.floor(Math.random() * pageLimit) + 1;
        const fetchUrl1 = `${baseUrl}&page=${page}`;
        const fetchUrl2 = `${baseUrl}&page=${page + 1}`;
        try {
          const [res1, res2] = await Promise.all([
            fetch(fetchUrl1),
            fetch(fetchUrl2),
          ]);
          if (!res1.ok || !res2.ok) continue;
          const [data1, data2] = await Promise.all([res1.json(), res2.json()]);
          const combined = [...(data1?.results || []), ...(data2?.results || [])];
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
      } else if (action === "maybe") {
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
    }, 250);
  }, [movies, currentIndex, savedIds, toggleSave, isGuest, guardAction]);

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
  }, [watchedModal, watchedSlider, toggleWatched, setWatchedRating]);

  const handleSwipe = useCallback((direction) => {
    handleAction(direction === "right" ? "save" : "skip");
  }, [handleAction]);

  const handleUndo = useCallback(() => {
    if (undoHistory.length === 0) return;
    const { movie, action, index } = undoHistory[0];
    if (action === "save") {
      if (savedIds.has(movie.id)) toggleSave(movie);
    }
    if (action === "maybe") {
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
          <span className="discover-session-count" style={{ opacity: 0.3 }}>0 / 30 discovered</span>
          <div className="discover-undo-btn disabled">
            <ShuffleIcon size={14} />
          </div>
          <div className="genre-dropdown" style={{ marginTop: 0 }}>
            <div className="genre-dropdown-trigger" style={{ opacity: 0.3 }}>
              <span>Filter by genre</span>
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
            <div className="discover-action-btn discover-maybe-btn" style={{ opacity: 0.3 }}><ClockIcon /></div>
            <span className="discover-action-label" style={{ opacity: 0.3 }}>Later</span>
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
        <span className={`discover-session-count${counterBump ? " bump" : ""}`}>{swipeCount} / {SESSION_LIMIT} discovered</span>
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
            <span>{activeGenres.size > 0 ? `Genres (${activeGenres.size})` : "Filter by genre"}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {filterOpen && (
            <div className="genre-dropdown-panel" ref={discoverGenreFloating.refs.setFloating} style={discoverGenreFloating.floatingStyles}>
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
          )}
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
          <button className="discover-action-btn discover-maybe-btn" onClick={() => handleAction("maybe")} aria-label="Maybe later">
            <ClockIcon />
          </button>
          <span className="discover-action-label">Later</span>
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
  const headerMenuFloating = useFloating({
    open: userMenuOpen,
    placement: "bottom-end",
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const sidebarMenuFloating = useFloating({
    open: userMenuOpen,
    placement: "right-start",
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
  const [badgeToast, setBadgeToast] = useState(null);
  const [activeMilestone, setActiveMilestone] = useState(null);
  const prevWatchedCount = useRef(watchedIds.size);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatsLoading, setChatsLoading] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveToStorage("cc_theme", theme);
    if (user) preferencesService.updateThemeSettings(user.id, { theme });
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
      showToast("Removed from watchlist", () => {
        setSavedIds((prev) => new Set(prev).add(id));
        setSavedMovies((prev) => new Map(prev).set(id, movie));
      });
    } else {
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
          setWatchedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
          setWatchedMovies((prev) => { const next = new Map(prev); next.delete(id); return next; });
          setWatchedDates((prev) => { const next = new Map(prev); next.delete(id); return next; });
          showToast("Removed from journal", () => {
            setWatchedIds((prev) => new Set(prev).add(id));
            setWatchedMovies((prev) => new Map(prev).set(id, movie));
            if (prevDate) setWatchedDates((prev) => new Map(prev).set(id, prevDate));
            if (prevNote !== undefined) setWatchedNotes((prev) => new Map(prev).set(id, prevNote));
            if (prevRating !== undefined) setWatchedRatings((prev) => new Map(prev).set(id, prevRating));
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
    setWatchedDates((prev) => new Map(prev).set(id, DateTime.now().toISO()));
    const wasSaved = savedIds.has(id);
    if (wasSaved) {
      setSavedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      setSavedMovies((prev) => { const next = new Map(prev); next.delete(id); return next; });
    }
    setCollections((prev) => prev.map((c) =>
      c.movieIds.includes(id) ? { ...c, movieIds: c.movieIds.filter((mid) => mid !== id) } : c
    ));
    showToast("Moved to journal");
  };

  const setWatchedNote = (id, text) => {
    setWatchedNotes((prev) => new Map(prev).set(id, sanitizeText(text).slice(0, 1000)));
  };

  const setWatchedRating = (id, rating) => {
    setWatchedRatings((prev) => {
      const next = new Map(prev);
      if (rating === null) next.delete(id); else next.set(id, rating);
      return next;
    });
  };

  const createCollection = (name) => {
    const id = Date.now().toString();
    const safeName = sanitizeText(name).slice(0, 50);
    setCollections((prev) => [...prev, { id, name: safeName, movieIds: [], isDefault: false }]);
    return id;
  };

  const renameCollection = (collectionId, newName) => {
    const safeName = sanitizeText(newName).slice(0, 50);
    setCollections((prev) => prev.map((c) => c.id === collectionId ? { ...c, name: safeName } : c));
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
        Toast.fire({ icon: "success", title: `Deleted "${col.name}"` });
        if (afterDelete) afterDelete();
      }
    });
  };

  const toggleMovieInCollection = (collectionId, movie) => {
    setSavedMovies((prev) => {
      if (!prev.has(movie.id)) {
        const next = new Map(prev);
        next.set(movie.id, movie);
        return next;
      }
      return prev;
    });
    let added = false;
    setCollections((prev) => prev.map((c) => {
      if (c.id !== collectionId) return c;
      const has = c.movieIds.includes(movie.id);
      added = !has;
      return { ...c, movieIds: has ? c.movieIds.filter((id) => id !== movie.id) : [...c.movieIds, movie.id] };
    }));
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
      preferencesService.updateGenrePreferences(user.id, { tasteProfile });
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
    setBadgeToast(badge);
  }, []);

  const dismissCelebration = useCallback(() => {
    setBadgeToast(null);
    // Mark as seen
    if (badgeToast) {
      const seenKey = `${badgeToast.id}_t${badgeToast.tierNum}`;
      const seen = loadFromStorage("cc_badge_seen", []);
      if (!seen.includes(seenKey)) saveToStorage("cc_badge_seen", [...seen, seenKey]);
    }
    setTimeout(() => showNextCelebration(), 400);
  }, [badgeToast, showNextCelebration]);

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
      if (!badgeToast) showNextCelebration();
    }
  }, [watchedMovies, watchedRatings, collections, watchedDates, unlockedBadges, showNextCelebration, badgeToast, chats]);
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
    { id: "search",   label: "Search",    icon: SearchIcon    },
    { id: "saved",    label: "Watchlist",  icon: BookmarkIcon  },
    { id: "discover", label: "Discover",   icon: DiscoverIcon  },
    { id: "journal",  label: "Journal",    icon: FilmStripIcon },
    { id: "chat",     label: "Chat",       icon: ChatIcon      },
  ];

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
      <div className="header">
        <div className="header-title">
          <CinnoLogo size={28} />
          Cinno
        </div>
        <div className="header-actions">
          {user ? (
            <div className="user-menu-wrapper" ref={userMenuRef}>
              <button className="user-avatar-btn" ref={headerMenuFloating.refs.setReference} onClick={() => setUserMenuOpen((v) => !v)}>
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="user-avatar-img" referrerPolicy="no-referrer" />
                ) : (
                  <div className="user-avatar-fallback"><UserIcon /></div>
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
            <button className="header-signin-btn" onClick={signInWithGoogle}>
              Sign in
            </button>
          )}
          <button className="header-settings-btn" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
        </div>
      </div>

      <div className={`tab-panel ${tabFading ? "tab-fade-out" : ""} ${tabDir === "fade-in" ? "tab-fade-in" : ""}`} key={activeTab}>
        {activeTab === "search" && (
          <SearchTab savedIds={savedIds} toggleSave={guardedToggleSave} watchedIds={watchedIds} toggleWatched={guardedToggleWatched} startDebrief={guardedStartDebrief} collections={collections} toggleMovieInCollection={guardedToggleMovieInCollection} scrollPositions={scrollPositions} />
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
          />
        )}
        {activeTab === "discover" && (
          <DiscoverTab
            savedIds={savedIds} toggleSave={guardedToggleSave}
            watchedIds={watchedIds} toggleWatched={guardedToggleWatched}
            startDebrief={guardedStartDebrief}
            collections={collections} toggleMovieInCollection={guardedToggleMovieInCollection}
            setWatchedRating={guardedSetWatchedRating}
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

      <div className="tab-bar">
        {/* Desktop sidebar profile button — hidden on mobile */}
        <div className="sidebar-profile-wrapper" ref={userMenuRef}>
          <button
            className="sidebar-profile-btn"
            ref={sidebarMenuFloating.refs.setReference}
            onClick={() => {
              if (user) {
                setUserMenuOpen((v) => !v);
              } else {
                guardAction(() => {});
              }
            }}
          >
            {user && avatarUrl ? (
              <img src={avatarUrl} alt="" className="sidebar-profile-img" referrerPolicy="no-referrer" />
            ) : (
              <div className="sidebar-profile-fallback"><UserIcon /></div>
            )}
          </button>
          {userMenuOpen && (
            <div className="user-dropdown sidebar-dropdown" ref={sidebarMenuFloating.refs.setFloating} style={sidebarMenuFloating.floatingStyles}>
              <button className="user-dropdown-item" onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }}>
                <GearIcon /> Settings
              </button>
              <button className="user-dropdown-item user-dropdown-signout" onClick={() => { setUserMenuOpen(false); signOut(); }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign out
              </button>
            </div>
          )}
          <div className="sidebar-profile-divider" />
        </div>

        {tabs.map((tab) => (
          <button key={tab.id} className={`tab-item ${activeTab === tab.id ? "active" : ""}`} onClick={() => handleTabClick(tab.id)}>
            {activeTab === tab.id && <div className="tab-indicator" />}
            <tab.icon />
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onClearData={requestClearAllData}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}

      <BadgeUnlockCelebration badge={badgeToast} onDismiss={dismissCelebration} />
      <MilestoneCelebration milestone={activeMilestone} onDismiss={() => setActiveMilestone(null)} />
      {guestModal}
    </div>
  );
}
