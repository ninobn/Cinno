import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { getTrending, getPopular, getTopRated, getSimilar, searchMovies, discoverByGenres, discoverMovies, getHiddenGems, getWatchProviders, getMovieDetails, getMovieById, getMovieKeywords, tmdbToMovie, IMG_BASE } from "./tmdb.js";

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

const GENRE_COLORS = {
  Action: "#C4856A", Adventure: "#8BA88C", Animation: "#7AADA0", Comedy: "#C4B07A",
  Crime: "#A87070", Documentary: "#7A96AD", Drama: "#8B7EA8", Family: "#AD8EB8",
  Fantasy: "#9A86B8", History: "#A09880", Horror: "#8B2635", Music: "#7AADB8",
  Mystery: "#8A7A70", Romance: "#B8707E", "Sci-Fi": "#6AA0A0", Thriller: "#7A6A90",
  War: "#7A8A6B", Western: "#AD8A5E", Film: "#7A7878",
};

const ALL_SUGGESTIONS = [
  "Recommend a thriller", "Explain Inception's ending", "Movies like Parasite",
  "Best films of the 90s", "Hidden gem dramas", "What should I watch tonight?",
  "Movies with great soundtracks", "Underrated sci-fi films", "Best animated movies ever",
  "Movies like Interstellar", "Dark comedies worth watching", "Classic noir films",
  "Must-see foreign films", "Best ensemble casts", "Movies that make you think",
  "Feel-good films to rewatch",
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

// ─── localStorage Helpers ──────────────────────────────────────────────────────
function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("localStorage save failed:", e);
  }
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
];

function computeBadgeProgress(badgeId, { watchedMovies, watchedRatings, collections, watchedDates }) {
  switch (badgeId) {
    case "first_watch":    return watchedMovies.size;
    case "critic":         return watchedRatings.size;
    case "horror_fan": {
      let count = 0;
      watchedMovies.forEach((m) => { if (m.genre === "Horror") count++; });
      return count;
    }
    case "binge_watcher": {
      const dayCounts = {};
      watchedDates.forEach((dateStr) => { const day = dateStr.slice(0, 10); dayCounts[day] = (dayCounts[day] || 0) + 1; });
      return Object.values(dayCounts).reduce((mx, v) => Math.max(mx, v), 0);
    }
    case "collector": {
      return collections.filter((c) => !c.isDefault).length;
    }
    case "genre_explorer": {
      const seen = new Set();
      watchedMovies.forEach((m) => { if (m.genre && m.genre !== "Film") seen.add(m.genre); });
      return seen.size;
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
    // scroll by 3 cards: find tile width from first child
    const tile = el.querySelector(".scroll-tile");
    const gap = 8;
    const cardW = tile ? tile.offsetWidth + gap : 128;
    el.scrollBy({ left: dir * cardW * 3, behavior: "smooth" });
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
      {canLeft && (
        <button className="scroll-arrow scroll-arrow-left" onClick={() => scroll(-1)} aria-label="Scroll left">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}
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
      {canRight && (
        <button className="scroll-arrow scroll-arrow-right" onClick={() => scroll(1)} aria-label="Scroll right">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg>
        </button>
      )}
    </div>
  );
}

function MovieTile({ movie, onClick, isSaved, onToggleSave, className }) {
  const ratingColor = getRatingColor(movie.rating);
  const genreColor = GENRE_COLORS[movie.genre] || "#7A7878";
  return (
    <div className={`movie-tile ${className || ""}`} onClick={onClick} style={{ animationDelay: `${(movie._idx || 0) * 25}ms` }}>
      <div className="movie-poster">
        <PosterImage posterPath={movie.poster_path} title={movie.title} />
        <span className="movie-poster-rating" style={{ color: ratingColor }}>★ {movie.rating}</span>
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

  return createPortal(
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="movie-modal movie-modal-lg" onClick={(e) => e.stopPropagation()}>
        {posterBlurUrl && <div className="modal-poster-bg" style={{ backgroundImage: `url(${posterBlurUrl})` }} />}
        <div className="modal-handle-bar">
          <div className="modal-handle" />
        </div>
        <button className="modal-close-btn" onClick={onClose}>✕</button>
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
                <span className="modal-runtime-loading">...</span>
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
                    <button className="modal-collection-btn" onClick={() => setCollectionDropdown((v) => !v)}>
                      <FolderIcon />
                      Collection
                    </button>
                    {collectionDropdown && (
                      <div className="collection-dropdown">
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
                  <div className="modal-tagline-loading" />
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
                  <div className="loading-container"><div className="loading-spinner" /></div>
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

function JournalDetailModal({ movie, onClose, note, onSaveNote, isSaved, onToggleSave, onToggleWatched, rating, onSetRating, onStartDebrief, showToast }) {
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

  return createPortal(
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="movie-modal movie-modal-lg" onClick={(e) => e.stopPropagation()}>
        {posterBlurUrl && <div className="modal-poster-bg" style={{ backgroundImage: `url(${posterBlurUrl})` }} />}
        <div className="modal-handle-bar">
          <div className="modal-handle" />
        </div>
        <button className="modal-close-btn" onClick={onClose}>✕</button>
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
                <span className="modal-runtime-loading">...</span>
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
                onPointerUp={() => showToast && showToast("Rating updated")}
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
                  <div className="modal-tagline-loading" />
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

function SearchTab({ savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, collections, toggleMovieInCollection }) {
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
  const [heroIndex, setHeroIndex] = useState(0);

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

  // Auto-rotate hero banner every 8 seconds
  useEffect(() => {
    if (trendingMovies.length === 0) return;
    const count = Math.min(trendingMovies.length, 5);
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % count);
    }, 8000);
    return () => clearInterval(timer);
  }, [trendingMovies]);

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
    setQuery(q);
    setSearchPage(1);
    setFetchError(false);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim()) {
      setSearchResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const result = await searchMovies(q, 1);
        setSearchResults(result.movies);
        setSearchTotalPages(result.totalPages || 1);
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
              onClick={() => setGenreDropdownOpen((o) => !o)}
              aria-expanded={genreDropdownOpen}
            >
              <span>{isGenreFiltered ? `Genres (${selectedGenres.length})` : "Filter by genre"}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {genreDropdownOpen && (
              <div className="genre-dropdown-panel">
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
              <div className="results-label">
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
            <div className="section-label">{browseLabel}</div>
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
            {!trendingLoading && trendingMovies.length > 0 && (
              <div className="hero-banner">
                {trendingMovies.slice(0, 5).map((movie, i) => (
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
                  {trendingMovies.slice(0, 5).map((_, i) => (
                    <button key={i} className={`hero-dot ${i === heroIndex ? 'active' : ''}`} onClick={() => setHeroIndex(i)} />
                  ))}
                </div>
              </div>
            )}

            {/* Two-column sections grid */}
            <div className="browse-sections-grid">
              <div className="browse-section">
                <div className="section-label">Everyone's Watching
                  <button className="desktop-refresh-btn" onClick={handleDesktopRefresh} disabled={refreshing} title="Refresh">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "spinning" : ""}>
                      <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                    </svg>
                  </button>
                </div>
                {trendingLoading ? (
                  <div className="scroll-row"><div className="scroll-row-inner">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton-tile scroll-tile" />)}</div></div>
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
                <div className="section-label">Hidden Gems</div>
                {gemsLoading ? (
                  <div className="scroll-row"><div className="scroll-row-inner">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton-tile scroll-tile" />)}</div></div>
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
            </div>

            {/* All-Time Greats — full width */}
            <div className="section-label" style={{ marginTop: 24 }}>All-Time Greats</div>
            {topRatedLoading ? (
              <div className="scroll-row"><div className="scroll-row-inner">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton-tile scroll-tile" />)}</div></div>
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

function ShareWatchlistModal({ onClose, savedMovies, showToast }) {
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
      if (showToast) showToast("Copied to clipboard");
    } catch {
      const input = document.createElement("textarea");
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      if (showToast) showToast("Copied to clipboard");
    }
  };

  return createPortal(
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="share-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle-bar"><div className="modal-handle" /></div>
        <button className="modal-close-btn" onClick={onClose}>✕</button>
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
            <div className="logo-mark">C</div>
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
                style={{ animationDelay: `${(movie._idx || 0) * 25}ms` }}
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
        <div className="movie-modal-overlay" onClick={() => setSelectedMovie(null)}>
          <div className="shared-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-handle-bar"><div className="modal-handle" /></div>
            <button className="modal-close-btn" onClick={() => setSelectedMovie(null)}>✕</button>
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

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    onClose();
  };

  return createPortal(
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="collection-create-modal" onClick={(e) => e.stopPropagation()}>
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

function CollectionCard({ collection, savedMovies, onClick }) {
  const previewMovies = collection.movieIds
    .slice(0, 3)
    .map((id) => savedMovies.get(id))
    .filter(Boolean);

  return (
    <div className="collection-card scroll-tile" onClick={onClick}>
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

function CollectionDetailView({ collection, savedMovies, savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, onBack, onRename, onDelete, collections, toggleMovieInCollection }) {
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
          {!collection.isDefault && (
            <button className="collection-delete-btn" onClick={() => { onDelete(collection.id); onBack(); }}>
              <TrashIcon />
            </button>
          )}
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

function SavedTab({ savedIds, toggleSave, savedMovies, watchedIds, toggleWatched, startDebrief, collections, createCollection, renameCollection, deleteCollection, toggleMovieInCollection, onStartMoviePicker, showToast }) {
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [emptyMsg] = useState(() => pickRandom(EMPTY_WATCHLIST));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeCollection, setActiveCollection] = useState(null);

  const movies = useMemo(
    () => Array.from(savedMovies.values()).map((m, i) => ({ ...m, _idx: i })),
    [savedMovies]
  );

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
        collections={collections}
        toggleMovieInCollection={toggleMovieInCollection}
      />
    );
  }

  return (
    <>
      <div className="content">
        <button className="movie-picker-card" onClick={onStartMoviePicker}>
          <div className="movie-picker-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" /><line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="7" x2="22" y2="7" /><line x1="17" y1="17" x2="22" y2="17" />
            </svg>
          </div>
          <div className="movie-picker-text">
            <div className="movie-picker-title">Movie Picker</div>
            <div className="movie-picker-desc">Tell me the vibe, I'll find the film</div>
          </div>
          <svg className="movie-picker-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 6 15 12 9 18" /></svg>
        </button>

        <div className="collections-section">
          <div className="collections-header">
            <div className="collections-title">My Collections</div>
            <button className="collections-add-btn" onClick={() => setShowCreateModal(true)}>
              <PlusIcon />
            </button>
          </div>
          <div className="collections-scroll">
            {collections.map((col) => (
              <CollectionCard
                key={col.id}
                collection={col}
                savedMovies={savedMovies}
                onClick={() => setActiveCollection(col.id)}
              />
            ))}
          </div>
        </div>

        {movies.length === 0 ? (
          <div className="saved-empty">
            <div className="saved-icon">{emptyMsg.icon}</div>
            <div className="saved-title">{emptyMsg.title}</div>
            <div className="saved-desc">{emptyMsg.desc}</div>
          </div>
        ) : (
          <>
            <div className="watchlist-header-row">
              <div className="results-label">{movies.length} movie{movies.length !== 1 ? "s" : ""} in your watchlist</div>
              <button className="watchlist-share-btn" onClick={() => setShowShareModal(true)} title="Share watchlist">
                <ShareIcon />
              </button>
            </div>
            <div className="movies-grid">
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
      {showCreateModal && (
        <CreateCollectionModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createCollection}
        />
      )}
      {showShareModal && (
        <ShareWatchlistModal
          onClose={() => setShowShareModal(false)}
          savedMovies={savedMovies}
          showToast={showToast}
        />
      )}
    </>
  );
}

// ─── Stats View ────────────────────────────────────────────────────────────────

function StatsView({ watchedMovies, watchedRatings, watchedDates, unlockedBadges, collections }) {
  const statsRef = useRef(null);

  const stats = useMemo(() => {
    const totalMovies = watchedMovies.size;
    const totalHours = totalMovies * 2;
    const totalGenresExplored = new Set();
    watchedMovies.forEach((m) => totalGenresExplored.add(m.genre || "Other"));
    const avgRating = watchedRatings.size > 0
      ? Math.round([...watchedRatings.values()].reduce((s, v) => s + v, 0) / watchedRatings.size)
      : 0;

    let highest = null;
    let lowest = null;
    let highScore = -1;
    let lowScore = 101;

    watchedRatings.forEach((score, id) => {
      const movie = watchedMovies.get(id);
      if (!movie) return;
      if (score > highScore) { highScore = score; highest = movie; }
      if (score < lowScore) { lowScore = score; lowest = movie; }
    });

    const genreCounts = {};
    watchedMovies.forEach((movie) => {
      const genre = movie.genre || "Other";
      genreCounts[genre] = (genreCounts[genre] || 0) + 1;
    });

    const genres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));

    // Unpopular opinions
    const disagreements = [];
    watchedRatings.forEach((userScore, id) => {
      const movie = watchedMovies.get(id);
      if (!movie || movie.rating === "—") return;
      const tmdbScore = parseFloat(movie.rating) * 10;
      const diff = userScore - tmdbScore;
      disagreements.push({ movie, userScore, tmdbScore: parseFloat(movie.rating), diff, absDiff: Math.abs(diff) });
    });
    disagreements.sort((a, b) => b.absDiff - a.absDiff);
    const unpopularOpinions = disagreements.slice(0, 3);

    // Recent activity (last 5 by date)
    const recentActivity = [];
    if (watchedDates) {
      const sorted = [...watchedDates.entries()].sort((a, b) => b[1].localeCompare(a[1]));
      for (const [id, dateStr] of sorted.slice(0, 5)) {
        const movie = watchedMovies.get(id);
        if (movie) recentActivity.push({ movie, date: dateStr });
      }
    }

    return {
      totalMovies, totalHours, avgRating,
      genreCount: totalGenresExplored.size,
      highest: highest ? { movie: highest, score: highScore } : null,
      lowest: lowest ? { movie: lowest, score: lowScore } : null,
      genres,
      unpopularOpinions,
      recentActivity,
    };
  }, [watchedMovies, watchedRatings, watchedDates]);

  useEffect(() => {
    const container = statsRef.current;
    if (!container) return;
    const cards = container.querySelectorAll(".stats-card");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [stats]);

  if (stats.totalMovies === 0) {
    return (
      <div className="rankings-empty">
        Watch some movies to see your stats here.
      </div>
    );
  }

  const totalGenreMovies = stats.genres.reduce((sum, g) => sum + g.count, 0);
  const donutSize = 100;
  const strokeWidth = 18;
  const radius = (donutSize - strokeWidth) / 2;
  const cx = donutSize / 2;
  const cy = donutSize / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const arcs = stats.genres.map((g) => {
    const pct = g.count / totalGenreMovies;
    const dashLen = circumference * pct;
    const rotation = (cumulativeOffset / totalGenreMovies) * 360 - 90;
    cumulativeOffset += g.count;
    const color = GENRE_COLORS[g.name] || "#7A7878";
    return { ...g, pct, dashLen, rotation, color };
  });

  return (
    <div className="stats-grid" ref={statsRef}>
      {/* ── Quick Stats Row ── */}
      <div className="stats-card full stats-row">
        <div className="stat-mini">
          <div className="stat-mini-num">{stats.totalMovies}</div>
          <div className="stat-mini-label">movies</div>
        </div>
        <div className="stat-mini">
          <div className="stat-mini-num">{stats.totalHours}h</div>
          <div className="stat-mini-label">watched</div>
        </div>
        <div className="stat-mini">
          <div className="stat-mini-num">{stats.avgRating}</div>
          <div className="stat-mini-label">avg rating</div>
        </div>
        <div className="stat-mini">
          <div className="stat-mini-num">{stats.genreCount}</div>
          <div className="stat-mini-label">genres</div>
        </div>
      </div>

      {/* ── Best vs Worst ── */}
      {stats.highest && stats.lowest && (
        <div className="stats-card full">
          <div className="stats-card-label">Best vs Worst</div>
          <div className="stats-vs">
            <div className="stats-vs-side">
              <div className="stats-card-poster">
                <PosterImage posterPath={stats.highest.movie.poster_path} title={stats.highest.movie.title} />
              </div>
              <div className="stats-vs-info">
                <div className="stats-card-title">{stats.highest.movie.title}</div>
                <ScoreRing score={stats.highest.score} size={38} />
              </div>
            </div>
            <div className="stats-vs-divider">vs</div>
            <div className="stats-vs-side">
              <div className="stats-card-poster">
                <PosterImage posterPath={stats.lowest.movie.poster_path} title={stats.lowest.movie.title} />
              </div>
              <div className="stats-vs-info">
                <div className="stats-card-title">{stats.lowest.movie.title}</div>
                <ScoreRing score={stats.lowest.score} size={38} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Genre Breakdown ── */}
      {stats.genres.length > 0 && (
        <div className="stats-card full">
          <div className="stats-card-label">Genre Breakdown</div>
          <div className="stats-genre-row">
            <div className="stats-donut-container">
              <svg width={donutSize} height={donutSize} viewBox={`0 0 ${donutSize} ${donutSize}`}>
                {arcs.map((arc) => (
                  <circle
                    key={arc.name}
                    cx={cx} cy={cy} r={radius}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${arc.dashLen} ${circumference - arc.dashLen}`}
                    transform={`rotate(${arc.rotation} ${cx} ${cy})`}
                  />
                ))}
              </svg>
            </div>
            <div className="stats-genre-bars">
              {arcs.slice(0, 6).map((g) => (
                <div key={g.name} className="genre-bar-row">
                  <span className="genre-bar-dot" style={{ background: g.color }} />
                  <span className="genre-bar-name">{g.name}</span>
                  <div className="genre-bar-track">
                    <div className="genre-bar-fill" style={{ width: `${g.pct * 100}%`, background: g.color }} />
                  </div>
                  <span className="genre-bar-count">{g.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Unpopular Opinions ── */}
      {stats.unpopularOpinions.length > 0 && (
        <div className="stats-card full">
          <div className="stats-card-label">Unpopular Opinions</div>
          <div className="stats-card-sublabel">Your biggest disagreements with the public</div>
          <div className="unpopular-list">
            {stats.unpopularOpinions.map((item) => (
              <div key={item.movie.id} className="unpopular-item">
                <div className="unpopular-poster">
                  <PosterImage posterPath={item.movie.poster_path} title={item.movie.title} />
                </div>
                <div className="unpopular-info">
                  <div className="unpopular-title">{item.movie.title}</div>
                  <div className="unpopular-scores">
                    <div className="unpopular-score-pair">
                      <span className="unpopular-score-label">You</span>
                      <ScoreRing score={item.userScore} size={36} />
                    </div>
                    <div className="unpopular-vs">vs</div>
                    <div className="unpopular-score-pair">
                      <span className="unpopular-score-label">TMDB</span>
                      <span className="unpopular-tmdb">{item.tmdbScore.toFixed(1)}</span>
                    </div>
                  </div>
                </div>
                <div className={`unpopular-diff ${item.diff > 0 ? "higher" : "lower"}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    {item.diff > 0 ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}
                  </svg>
                  {Math.round(item.absDiff)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Activity ── */}
      {stats.recentActivity.length > 0 && (
        <div className="stats-card full">
          <div className="stats-card-label">Recent Activity</div>
          <div className="recent-activity-row">
            {stats.recentActivity.map((item) => (
              <div key={item.movie.id} className="recent-activity-item">
                <div className="recent-activity-poster">
                  <PosterImage posterPath={item.movie.poster_path} title={item.movie.title} />
                </div>
                <div className="recent-activity-date">{new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Achievements (Tiered) ── */}
      {(() => {
        const badgeCtx = { watchedMovies, watchedRatings, collections: collections || [], watchedDates: watchedDates || new Map() };
        const totalTiers = BADGE_DEFS.length * 3;
        let earnedTiers = 0;
        BADGE_DEFS.forEach((b) => { earnedTiers += getBadgeTier(computeBadgeProgress(b.id, badgeCtx), b.tiers); });
        return (
          <div className="stats-card full achievements-section">
            <div className="achievements-inline-header">
              <div className="stats-card-label">Achievements</div>
              <div className="achievements-count">{earnedTiers} of {totalTiers} tiers</div>
            </div>
            <div className="achievements-inline-bar">
              <div className="achievements-inline-bar-fill" style={{ width: `${(earnedTiers / totalTiers) * 100}%` }} />
            </div>
            <div className="badge-grid-inline">
              {BADGE_DEFS.map((badge) => {
                const progress = computeBadgeProgress(badge.id, badgeCtx);
                const tier = getBadgeTier(progress, badge.tiers);
                const tierColor = tier > 0 ? TIER_COLORS[["bronze", "silver", "gold"][tier - 1]] : null;
                const nextTier = Math.min(tier + 1, 3);
                const nextTarget = badge.tiers[nextTier - 1];
                const prevTarget = tier > 0 ? badge.tiers[tier - 1] : 0;
                const pct = tier >= 3 ? 100 : Math.min(((progress - prevTarget) / (nextTarget - prevTarget)) * 100, 100);
                const Icon = badge.icon;
                return (
                  <div key={badge.id} className={`badge-inline ${tier > 0 ? "unlocked" : "locked"}`}>
                    <div className="badge-inline-icon" style={tierColor ? { color: tierColor } : undefined}>
                      {tier > 0 && (
                        <div className="badge-tier-ring" style={{ borderColor: tierColor, boxShadow: tier === 3 ? `0 0 8px ${tierColor}44` : "none" }} />
                      )}
                      {tier === 0 && <div className="badge-inline-lock"><LockIcon /></div>}
                      <Icon />
                    </div>
                    <div className="badge-inline-name">{badge.title}</div>
                    {tier > 0 && <div className="badge-tier-label" style={{ color: tierColor }}>{TIER_NAMES[tier]}</div>}
                    <div className="badge-inline-progress">
                      <div className="badge-inline-track">
                        <div className="badge-inline-fill" style={{ width: `${pct}%`, background: tierColor || undefined }} />
                      </div>
                      <span className="badge-inline-frac">{progress}/{tier >= 3 ? badge.tiers[2] : nextTarget}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Genre Mastery ── */}
      {watchedMovies.size > 0 && (() => {
        const genreCounts = {};
        watchedMovies.forEach((m) => {
          const g = m.genre || "Film";
          if (g !== "Film") genreCounts[g] = (genreCounts[g] || 0) + 1;
        });
        const sorted = Object.entries(genreCounts).sort(([, a], [, b]) => b - a);
        if (sorted.length === 0) return null;
        return (
          <div className="stats-card full genre-mastery-section">
            <div className="stats-card-label">Genre Mastery</div>
            <div className="genre-mastery-list">
              {sorted.map(([genre, count]) => {
                const mastery = getMasteryLevel(count);
                const max = getMasteryMax(count);
                const pct = Math.min((count / max) * 100, 100);
                const isMaster = mastery.label === "Master";
                return (
                  <div key={genre} className="genre-mastery-row">
                    <div className={`genre-mastery-name ${isMaster ? "master" : ""}`}>{genre}</div>
                    <div className="genre-mastery-bar-wrap">
                      <div className="genre-mastery-track">
                        <div className="genre-mastery-fill" style={{ width: `${pct}%`, background: isMaster ? TIER_COLORS.gold : `${GENRE_COLORS[genre] || "var(--accent)"}` }} />
                      </div>
                      <span className="genre-mastery-label">{mastery.label}</span>
                    </div>
                    <span className="genre-mastery-count">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
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

function JournalTab({ watchedMovies, watchedNotes, setWatchedNote, watchedIds, toggleWatched, savedIds, toggleSave, watchedRatings, setWatchedRating, watchedDates, tasteProfile, onSetTasteProfile, startDebrief, unlockedBadges, collections, showToast }) {
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [view, setView] = useState("journal");
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
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 120, system: systemPrompt, messages: [{ role: "user", content: userPrompt }] }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      const text = data.content?.[0]?.text?.trim();
      if (text) {
        const result = { type: insightType, text, ts: Date.now() };
        localStorage.setItem("cc_aiInsight", JSON.stringify(result));
        setInsight({ type: insightType, text });
        onSetTasteProfile(text);
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
    localStorage.removeItem("cc_aiInsight");
    setInsight(null);
    fetchInsight();
  }, [fetchInsight]);

  // Auto-fetch on mount — always fresh
  useEffect(() => {
    if (movies.length < 3) return;
    fetchInsight();
  }, [movies.length >= 3 ? "ready" : "waiting"]);

  // Persist sort preferences
  useEffect(() => { saveToStorage("cc_rankSort", rankSort); }, [rankSort]);
  useEffect(() => { saveToStorage("cc_journalSort", journalSort); }, [journalSort]);
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

  return (
    <>
      <div className="content">
        <div className="journal-toggle">
          <button className={`journal-toggle-btn ${view === "journal" ? "active" : ""}`} onClick={() => setView("journal")}>Journal</button>
          <button className={`journal-toggle-btn ${view === "rankings" ? "active" : ""}`} onClick={() => setView("rankings")}>Rankings</button>
          <button className={`journal-toggle-btn ${view === "stats" ? "active" : ""}`} onClick={() => setView("stats")}>Stats</button>
        </div>

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
                <div className={`insight-card${insightLoading ? " insight-loading" : ""}`}>
                  {movies.length < 3 ? (
                    <p className="insight-text" style={{ fontStyle: "normal", color: "var(--text-muted)" }}>Watch at least 3 movies to unlock AI insights about your taste.</p>
                  ) : insightLoading ? (
                    <div className="insight-shimmer">
                      <div className="insight-shimmer-label" />
                      <div className="insight-shimmer-line" />
                      <div className="insight-shimmer-line short" />
                    </div>
                  ) : insight ? (
                    <>
                      <div className="insight-label">
                        {INSIGHT_ICONS[insight.type]}
                        {INSIGHT_LABELS[insight.type]}
                        <button className="insight-refresh" onClick={refreshInsight} title="New insight">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                          </svg>
                        </button>
                      </div>
                      <p className="insight-text">{insight.text}</p>
                    </>
                  ) : null}
                </div>

                <div className="journal-search-bar">
                  <span className="search-icon"><SearchIcon /></span>
                  <input
                    type="text"
                    placeholder="Search your movies..."
                    value={journalSearch}
                    onChange={(e) => setJournalSearch(e.target.value)}
                  />
                  {journalSearch && (
                    <button className="search-clear" onClick={() => setJournalSearch("")}>✕</button>
                  )}
                </div>

                <div className="journal-sort-header">
                  <div className="results-label">{filteredJournalMovies.length} watched movie{filteredJournalMovies.length !== 1 ? "s" : ""}</div>
                  <SortDropdown options={JOURNAL_SORT_OPTIONS} value={journalSort} onChange={setJournalSort} />
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
                        <div className="journal-genre-header" style={{ color: GENRE_COLORS[genre] || "var(--text-secondary)" }}>{genre}</div>
                        <div className="movies-grid">
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
                  <div className="movies-grid">
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
                    {rankingStats && (
                      <div className="rank-pills">
                        <div className="rank-pill"><span className="rank-pill-val">{rankingStats.total}</span> rated</div>
                        <div className="rank-pill">Avg: <span className="rank-pill-val">{rankingStats.avg}</span>/100</div>
                        <div className="rank-pill">Top: <span className="rank-pill-val">{rankingStats.topGenre}</span></div>
                      </div>
                    )}

                    <div className="rank-sort-row">
                      <SortDropdown options={RANK_SORT_OPTIONS} value={rankSort} onChange={setRankSort} />
                    </div>

                    {rankSort === "rating_desc" && rankedMovies.length >= 3 && (
                      <div className="podium">
                        <div className="podium-slot second" onClick={() => setSelectedMovie(rankedMovies[1])}>
                          <div className="podium-rank">2</div>
                          <div className="podium-poster">
                            <PosterImage posterPath={rankedMovies[1].poster_path} title={rankedMovies[1].title} />
                          </div>
                          <div className="podium-title">{rankedMovies[1].title}</div>
                          <ScoreRing score={watchedRatings.get(rankedMovies[1].id)} size={36} />
                        </div>
                        <div className="podium-slot first" onClick={() => setSelectedMovie(rankedMovies[0])}>
                          <div className="podium-rank">1</div>
                          <div className="podium-poster">
                            <PosterImage posterPath={rankedMovies[0].poster_path} title={rankedMovies[0].title} />
                          </div>
                          <div className="podium-title">{rankedMovies[0].title}</div>
                          <ScoreRing score={watchedRatings.get(rankedMovies[0].id)} size={40} />
                        </div>
                        <div className="podium-slot third" onClick={() => setSelectedMovie(rankedMovies[2])}>
                          <div className="podium-rank">3</div>
                          <div className="podium-poster">
                            <PosterImage posterPath={rankedMovies[2].poster_path} title={rankedMovies[2].title} />
                          </div>
                          <div className="podium-title">{rankedMovies[2].title}</div>
                          <ScoreRing score={watchedRatings.get(rankedMovies[2].id)} size={36} />
                        </div>
                      </div>
                    )}

                    <div className="rankings-list">
                      {(rankSort === "rating_desc" && rankedMovies.length >= 3 ? rankedMovies.slice(3) : rankedMovies).map((movie, i) => {
                        const rank = rankSort === "rating_desc" && rankedMovies.length >= 3 ? i + 4 : i + 1;
                        return (
                          <div key={movie.id} className="ranking-item" onClick={() => setSelectedMovie(movie)} style={{ animationDelay: `${i * 30}ms` }}>
                            <span className="ranking-num">#{rank}</span>
                            <div className="ranking-poster">
                              <PosterImage posterPath={movie.poster_path} title={movie.title} />
                            </div>
                            <div className="ranking-info">
                              <div className="ranking-title">{movie.title}</div>
                              <div className="ranking-meta">{movie.genre} · {movie.year}</div>
                            </div>
                            <ScoreRing score={watchedRatings.get(movie.id)} size={38} />
                          </div>
                        );
                      })}
                    </div>

                    <div className={`insight-card${insightLoading ? " insight-loading" : ""}`} style={{ marginTop: 16 }}>
                      {movies.length < 3 ? (
                        <p className="insight-text" style={{ fontStyle: "normal", color: "var(--text-muted)" }}>Watch at least 3 movies to unlock AI insights about your taste.</p>
                      ) : insightLoading ? (
                        <div className="insight-shimmer">
                          <div className="insight-shimmer-label" />
                          <div className="insight-shimmer-line" />
                          <div className="insight-shimmer-line short" />
                        </div>
                      ) : insight ? (
                        <>
                          <div className="insight-label">
                            {INSIGHT_ICONS[insight.type]}
                            {INSIGHT_LABELS[insight.type]}
                            <button className="insight-refresh" onClick={refreshInsight} title="New insight">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                              </svg>
                            </button>
                          </div>
                          <p className="insight-text">{insight.text}</p>
                        </>
                      ) : null}
                    </div>

                  </>
                )}
              </>
            )}

            {view === "stats" && (
              <StatsView watchedMovies={watchedMovies} watchedRatings={watchedRatings} watchedDates={watchedDates} unlockedBadges={unlockedBadges} collections={collections} />
            )}
          </>
        )}
      </div>

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
          showToast={showToast}
        />
      )}
    </>
  );
}

// ─── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab({ chats, setChats, activeChatId, setActiveChatId, tasteProfile, debriefPayload, onDebriefHandled }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [typingHint, setTypingHint] = useState(null);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const textareaRef = useRef(null);
  const debriefHandledRef = useRef(null);

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

  const updateMessages = (newMsgs) => {
    setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, messages: newMsgs } : c)));
  };

  const createNewChat = () => {
    const newId = Date.now().toString();
    setChats((prev) => [{ id: newId, title: "New chat", messages: [] }, ...prev]);
    setActiveChatId(newId);
    setSidebarOpen(false);
  };

  const selectChat = (id) => { setActiveChatId(id); setSidebarOpen(false); };

  const deleteChat = (id) => {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (id === activeChatId) {
        if (next.length > 0) setActiveChatId(next[0].id);
        else {
          const newId = Date.now().toString();
          next.push({ id: newId, title: "New chat", messages: [] });
          setActiveChatId(newId);
        }
      }
      return next;
    });
  };

  const startRename = (e, id, currentTitle) => {
    e.stopPropagation();
    setRenamingId(id);
    setRenameValue(currentTitle);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) {
      setChats((prev) => prev.map((c) => (c.id === renamingId ? { ...c, title: renameValue.trim() } : c)));
    }
    setRenamingId(null);
  };

  const generateTitle = async (userMsg, assistantMsg) => {
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 30,
          messages: [{ role: "user", content: `Generate a very short chat title (max 5 words, no quotes, no punctuation at end) that summarizes this movie conversation:\n\nUser: ${userMsg}\nAssistant: ${assistantMsg.slice(0, 200)}` }],
        }),
      });
      const data = await resp.json();
      const title = data.content?.[0]?.text?.trim();
      if (title) setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, title } : c)));
    } catch {
      const fallback = userMsg.length > 28 ? userMsg.slice(0, 28) + "…" : userMsg;
      setChats((prev) => prev.map((c) => (c.id === activeChatId ? { ...c, title: fallback } : c)));
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
  const formatTimestamp = useCallback((ts) => {
    if (!ts) return null;
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (isToday) return `Today, ${time}`;
    if (isYesterday) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
  }, []);

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
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;

    setInput("");
    setError("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const newMessages = [...messages, { role: "user", content: userMsg, ts: Date.now() }];
    updateMessages(newMessages);
    const isFirstMessage = messages.length === 0;
    const TYPING_HINTS = [
      "Replaying that moment...", "Thinking about that scene...", "Processing your take...",
      "That soundtrack though...", "Picturing the cinematography...", "Rewinding to that part...",
      "Sitting with that ending...",
    ];
    setTypingHint(Math.random() < 0.4 ? TYPING_HINTS[Math.floor(Math.random() * TYPING_HINTS.length)] : null);
    setLoading(true);

    try {
      let movieContext;
      const picker = activeChat?.pickerMode;
      const pc = activeChat?.pickerContext;

      if (picker) {
        movieContext = `You are a movie picker assistant helping someone decide what to watch right now. Be warm, casual, and conversational — like a friend who just happens to know every movie ever made.

Your approach: Have a natural conversation to understand what they want. Ask naturally (not as a form): how many people are watching, what mood or vibe they want, any genre or decade preferences, and whether they want something new or a comfort rewatch. Don't ask all at once — let the conversation flow. If they already gave you some info, work with it and ask follow-up questions.

Once you have enough info, recommend 2-3 specific movies with title, year, and a one-sentence reason each. Be opinionated and decisive — don't hedge.

Never use internet slang. No bold, no emojis, no markdown formatting ever. Bullet points are fine for listing movies.${pc?.watched ? `\n\nMovies they've watched recently: ${pc.watched}` : ""}${pc?.watchlist ? `\n\nMovies on their watchlist (haven't watched yet): ${pc.watchlist}` : ""}${pc?.tasteProfile ? `\n\nTheir taste profile: ${pc.tasteProfile}` : ""}`;
      } else {
        const personalContext = tasteProfile ? `The user's taste profile: ${tasteProfile}` : "";
        const mc = activeChat?.movieContext;
        const debriefContext = mc ? `\n\nThe user is debriefing about "${mc.title}" (${mc.year}, ${mc.genre}). TMDB rating: ${mc.tmdbRating}/10. Synopsis: ${mc.synopsis}.` : "";
        movieContext = `You're a movie-loving friend who genuinely enjoys talking about films. Keep it conversational and natural. Match the user's energy — short replies when they're casual, longer when they ask something deeper. Don't volunteer cast, director, or production details unless asked.

You have two modes and should switch fluidly based on context:
- Casual mode: relaxed, conversational, opinionated. Crack jokes when it fits. Keep recommendations tight — movie name, year, one sentence why. This is the default.
- Thoughtful mode: when someone asks for a plot explanation, thematic analysis, character breakdown, or recommendation reasoning, respond with clarity and depth. Be insightful without being academic. Structure your thoughts but keep the tone warm and approachable.

Never use internet slang (no "lol", "ngl", "fr", "lowkey", "tbh", "imo"). Write like a real person having a real conversation, not like a text message. Bullet points are acceptable when listing things. No bold, no emojis, no markdown formatting ever.${debriefContext}${personalContext ? "\n\n" + personalContext : ""}`;
      }

      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: movieContext,
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || data.error.type || "API error");

      const assistantText = data.content?.filter((b) => b.type === "text").map((b) => b.text).join("\n") || "I couldn't generate a response. Please try again.";
      updateMessages([...newMessages, { role: "assistant", content: assistantText, ts: Date.now() }]);

      if (isFirstMessage && !activeChat?.movieContext && !activeChat?.pickerMode) generateTitle(userMsg, assistantText);
    } catch {
      setError("Chat is temporarily unavailable. Please try again in a moment.");
    } finally {
      setLoading(false);
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
          <button className="chat-topbar-new" onClick={createNewChat} title="New chat">+</button>
        </div>

        <div className="chat-messages-wrap">
          <div className="chat-messages" ref={messagesContainerRef} onScroll={handleMessagesScroll}>
            {messages.length === 0 && !loading ? (
              <div className="chat-welcome">
                <div className="chat-avatar-lg"><BotIcon /></div>
                <h2>Movie Companion</h2>
                <p>Ask me anything about movies — recommendations, plot breakdowns, character analysis, or just chat about your favorites.</p>
                <div className="chat-suggestions">
                  {suggestions.map((s) => (
                    <button key={s} className="chat-suggestion" onClick={() => sendMessage(s)}>{s}</button>
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

        <div className="chat-input-container">
          {followupChips && !input.trim() && (
            <div className="chat-followup-chips">
              {followupChips.map((chip) => (
                <button key={chip} className="chat-followup-chip" onClick={() => sendMessage(chip)}>{chip}</button>
              ))}
            </div>
          )}
          <div className="chat-input-bar">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoResize(); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about any movie..."
              rows={1}
            />
            <button className="chat-send" onClick={() => sendMessage()} disabled={!input.trim() || loading}>
              <SendIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Modal ────────────────────────────────────────────────────────────

function GlobalToast({ message }) {
  if (!message) return null;
  return createPortal(
    <div className="global-toast" key={message}>{message}</div>,
    document.body
  );
}

function BadgeToast({ badge, visible }) {
  if (!badge) return null;
  const Icon = badge.icon;
  const tierNum = badge.tierNum || 1;
  const tierName = TIER_NAMES[tierNum] || "Bronze";
  const tierColor = TIER_COLORS[["bronze", "silver", "gold"][tierNum - 1]] || TIER_COLORS.bronze;
  return createPortal(
    <div className={`badge-toast ${visible ? "show" : "hide"}`}>
      <div className="badge-toast-icon" style={{ color: tierColor, borderColor: tierColor }}><Icon /></div>
      <div className="badge-toast-content">
        <div className="badge-toast-label" style={{ color: tierColor }}>{tierName} Unlocked</div>
        <div className="badge-toast-title">{badge.title}</div>
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
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeLabel = options.find((o) => o.value === value)?.label || "";

  return (
    <div className="sort-dropdown" ref={ref}>
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
  const [confirmClear, setConfirmClear] = useState(false);

  const handleClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    onClearData();
    onClose();
  };

  return (
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="movie-modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-handle" />
        <div className="settings-header">
          <div className="settings-title">Settings</div>
          <button className="modal-close-btn" style={{ position: "static" }} onClick={onClose}>✕</button>
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
              <div className="settings-desc">{confirmClear ? "This cannot be undone!" : "Remove all saved movies, journal entries and chats"}</div>
            </div>
            <button className={`settings-clear-btn ${confirmClear ? "confirm" : ""}`} onClick={handleClear}>
              {confirmClear ? "Confirm" : "Clear"}
            </button>
          </div>
        </div>

        <div className="settings-version">Cinno v0.1</div>
      </div>
    </div>
  );
}

// ─── Discover Tab (Tinder-style swiping) ────────────────────────────────────────

const DISCOVER_GENRE_IDS = GENRE_FILTERS.map((g) => g.id);
const GENRE_ID_TO_LABEL = {};
GENRE_FILTERS.forEach((g) => { GENRE_ID_TO_LABEL[g.id] = g.label; });
const GENRE_LABEL_TO_ID = {};
GENRE_FILTERS.forEach((g) => { GENRE_LABEL_TO_ID[g.label] = g.id; });

function buildTasteProfile(watchedMovies, watchedRatings) {
  const hasData = watchedMovies?.size > 0;
  const genreScores = {};
  const genreCounts = {};
  const decadeCounts = {};
  const ratedMovies = [];

  if (hasData) {
    watchedMovies.forEach((m, id) => {
      const genre = m.genre || "Film";
      const rating = watchedRatings?.get(id);
      if (rating != null) {
        genreScores[genre] = (genreScores[genre] || 0) + rating;
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
        ratedMovies.push({ id, rating, genre });
      } else {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      }
      const year = parseInt(m.year);
      if (year) {
        const decade = `${Math.floor(year / 10) * 10}s`;
        decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
      }
    });
  }

  // Average rating per genre
  const genreAvg = {};
  Object.entries(genreScores).forEach(([g, total]) => {
    genreAvg[g] = Math.round(total / genreCounts[g]);
  });

  // Top 3 genre IDs by score, fallback to count
  const sortedGenres = Object.entries(genreCounts)
    .sort(([a], [b]) => (genreAvg[b] || 50) - (genreAvg[a] || 50))
    .map(([label]) => GENRE_LABEL_TO_ID[label])
    .filter(Boolean);
  const topGenreIds = sortedGenres.slice(0, 3);

  // Top 2 preferred decades
  const preferredDecades = Object.entries(decadeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([d]) => d);

  // Top 5 rated movies for keyword fetching
  ratedMovies.sort((a, b) => b.rating - a.rating);
  const topRatedIds = ratedMovies.slice(0, 5).map((m) => m.id);

  return { genreAvg, topGenreIds, preferredDecades, topRatedIds, hasData, genreCounts };
}

const DISCOVER_CHIPS = [
  { id: 28, label: "Action" }, { id: 35, label: "Comedy" }, { id: 18, label: "Drama" },
  { id: 27, label: "Horror" }, { id: 878, label: "Sci-Fi" }, { id: 53, label: "Thriller" },
  { id: 10749, label: "Romance" }, { id: 16, label: "Animation" },
];

function DiscoverTab({ savedIds, toggleSave, watchedIds, toggleWatched, startDebrief, collections, toggleMovieInCollection, watchedMovies, watchedRatings, setWatchedRating, showToast }) {
  // ─── STEP 1: STATE ───
  const [movies, setMovies] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [swipeCount, setSwipeCount] = useState(0);
  const [genreBoosts, setGenreBoosts] = useState({});
  const [genrePenalties, setGenrePenalties] = useState({});
  const [swipeDir, setSwipeDir] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [undoHistory, setUndoHistory] = useState([]);
  const [showStamp, setShowStamp] = useState(null);
  const [cardDetails, setCardDetails] = useState({});
  const [activeGenres, setActiveGenres] = useState(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [maybeLater, setMaybeLater] = useState(() => loadFromStorage("cc_discover_maybe_later", []));
  const [watchedModal, setWatchedModal] = useState(null);
  const [watchedSlider, setWatchedSlider] = useState(75);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontalSwipe = useRef(false);
  const fetchingRef = useRef(false);
  const fetchedPagesRef = useRef(new Set());
  const swipingRef = useRef(false);
  const activeGenresRef = useRef(activeGenres);
  activeGenresRef.current = activeGenres;
  const genreBoostsRef = useRef(genreBoosts);
  genreBoostsRef.current = genreBoosts;
  const genrePenaltiesRef = useRef(genrePenalties);
  genrePenaltiesRef.current = genrePenalties;

  // Exclusion set: movies already in watchlist or journal
  const exclusionSet = useMemo(() => {
    const ids = new Set();
    savedIds.forEach((id) => ids.add(id));
    watchedIds.forEach((id) => ids.add(id));
    return ids;
  }, [savedIds, watchedIds]);

  // Taste profile from journal data
  const tasteProfile = useMemo(
    () => buildTasteProfile(watchedMovies, watchedRatings),
    [watchedMovies, watchedRatings]
  );

  // Only persist maybeLater to localStorage
  useEffect(() => { saveToStorage("cc_discover_maybe_later", maybeLater); }, [maybeLater]);

  // ─── STEP 2 & 4: FETCH LOGIC ───

  // Pick a random page 1-500 not already fetched this session
  const getRandomPage = useCallback(() => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const page = Math.floor(Math.random() * 500) + 1;
      if (!fetchedPagesRef.current.has(page)) return page;
    }
    return Math.floor(Math.random() * 500) + 1;
  }, []);

  // Compute effective top 3 genre IDs by merging journal scores with swipe boosts/penalties
  const getEffectiveGenres = useCallback(() => {
    const chipGenres = activeGenresRef.current;
    if (chipGenres.size > 0) {
      return { genreIds: [...chipGenres], isChipFilter: true };
    }

    // Build base scores from journal
    const scores = {};
    GENRE_FILTERS.forEach((g) => { scores[g.id] = 0; });

    if (tasteProfile.hasData) {
      Object.entries(tasteProfile.genreCounts).forEach(([label, count]) => {
        const gid = GENRE_LABEL_TO_ID[label];
        if (!gid) return;
        const avg = tasteProfile.genreAvg[label] || 50;
        scores[gid] = (avg / 50) * Math.min(count, 10);
      });
    }

    // Apply swipe boosts and penalties
    const boosts = genreBoostsRef.current;
    const penalties = genrePenaltiesRef.current;
    Object.entries(boosts).forEach(([gid, val]) => {
      scores[gid] = (scores[gid] || 0) + val;
    });
    Object.entries(penalties).forEach(([gid, val]) => {
      scores[gid] = (scores[gid] || 0) - val;
    });

    const sorted = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .filter(([, s]) => s > 0);

    const topIds = sorted.slice(0, 3).map(([id]) => parseInt(id));
    return { genreIds: topIds, isChipFilter: false };
  }, [tasteProfile]);

  const fetchMovies = useCallback(async (reset = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) {
      setLoading(true);
      fetchedPagesRef.current.clear();
    }

    try {
      const { genreIds, isChipFilter } = getEffectiveGenres();
      const hasProfile = genreIds.length > 0 || tasteProfile.hasData;

      // No profile at all: use trending + popular
      if (!hasProfile && !isChipFilter) {
        const [t, p] = await Promise.allSettled([getTrending(), getPopular()]);
        const tMovies = t.status === "fulfilled" ? t.value.movies : [];
        const pMovies = p.status === "fulfilled" ? p.value.movies : [];
        const all = [...tMovies, ...pMovies];
        const unique = [];
        const usedIds = new Set();
        all.forEach((m) => {
          if (!usedIds.has(m.id) && m.poster_path && !exclusionSet.has(m.id)) {
            usedIds.add(m.id);
            unique.push(m);
          }
        });
        unique.sort(() => Math.random() - 0.5);
        if (reset) {
          setMovies(unique);
          setCurrentIndex(0);
        } else {
          setMovies((prev) => [...prev, ...unique]);
        }
        unique.slice(0, 4).forEach((m) => {
          getMovieDetails(m.id).then((d) => {
            setCardDetails((prev) => ({ ...prev, [m.id]: { tagline: d.tagline || "" } }));
          }).catch(() => {});
        });
        return;
      }

      // Build TMDB discover params
      const useVariety = Math.random() < 0.1;
      let params = {
        "vote_average.gte": "6.5",
        "vote_count.gte": "100",
        with_original_language: "en",
        sort_by: "popularity.desc",
      };

      if (isChipFilter) {
        params.with_genres = genreIds.join(",");
      } else if (useVariety) {
        // 10% variety: random genre NOT in top 3
        const topSet = new Set(genreIds.map(String));
        const others = DISCOVER_GENRE_IDS.filter((id) => !topSet.has(String(id)));
        const randomGenre = others[Math.floor(Math.random() * others.length)];
        params.with_genres = String(randomGenre);
      } else {
        params.with_genres = genreIds.join(",");
      }

      // Retry up to 3 pages if filtering yields 0 results
      let newMovies = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const page = getRandomPage();
        fetchedPagesRef.current.add(page);

        console.log(`[Discover] Fetch attempt ${attempt + 1}/3, page ${page}, params:`, JSON.stringify(params));

        const data = await discoverMovies(params, page);
        console.log(`[Discover] TMDB returned ${data.movies.length} movies (totalPages: ${data.totalPages})`);

        newMovies = data.movies.filter(
          (m) => !exclusionSet.has(m.id) && m.poster_path
        );
        console.log(`[Discover] After exclusion filter: ${newMovies.length} movies`);

        if (newMovies.length > 0) break;
      }

      newMovies.sort(() => Math.random() - 0.5);

      if (reset) {
        setMovies(newMovies);
        setCurrentIndex(0);
      } else {
        // APPEND only, never replace
        setMovies((prev) => [...prev, ...newMovies]);
      }

      // Prefetch taglines for first 4
      newMovies.slice(0, 4).forEach((m) => {
        getMovieDetails(m.id).then((d) => {
          setCardDetails((prev) => ({ ...prev, [m.id]: { tagline: d.tagline || "" } }));
        }).catch(() => {});
      });
    } catch (e) {
      console.error("[Discover] Fetch failed:", e);
      if (reset) {
        try {
          const fallback = await getTrending();
          const filtered = fallback.movies.filter(
            (m) => !exclusionSet.has(m.id) && m.poster_path
          );
          setMovies(filtered);
          setCurrentIndex(0);
        } catch {}
      }
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [getEffectiveGenres, exclusionSet, tasteProfile, getRandomPage]);

  const fetchMoviesRef = useRef(fetchMovies);
  fetchMoviesRef.current = fetchMovies;

  // ─── Initial fetch on mount ───
  useEffect(() => {
    fetchMovies(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefetch taglines for upcoming 3 cards
  useEffect(() => {
    [movies[currentIndex], movies[currentIndex + 1], movies[currentIndex + 2]].forEach((m) => {
      if (m && !cardDetails[m.id]) {
        getMovieDetails(m.id).then((d) => {
          setCardDetails((prev) => ({ ...prev, [m.id]: { tagline: d.tagline || "" } }));
        }).catch(() => {});
      }
    });
  }, [currentIndex, movies, cardDetails]);

  // ─── STEP 3 & 4: Auto-fetch when running low (< 5 cards ahead) ───
  useEffect(() => {
    if (movies.length > 0 && movies.length - currentIndex < 5 && !fetchingRef.current) {
      fetchMoviesRef.current();
    }
  }, [currentIndex, movies.length]); // eslint-disable-line react-hooks/exhaustive-deps


  // Toggle genre chip
  const toggleGenreChip = useCallback((genreId) => {
    setActiveGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genreId)) next.delete(genreId);
      else next.add(genreId);
      return next;
    });
  }, []);

  // ─── SWIPE ACTION ───
  const handleAction = useCallback((action) => {
    if (swipingRef.current) return;
    const movie = movies[currentIndex];
    if (!movie) return;

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

    setTimeout(() => {
      if (action === "save") {
        if (!savedIds.has(movie.id)) toggleSave(movie);
      } else if (action === "maybe") {
        setMaybeLater((prev) => {
          if (prev.some((m) => m.id === movie.id)) return prev;
          return [{ ...movie, addedAt: Date.now() }, ...prev].slice(0, 50);
        });
        showToast("Saved for later");
      } else if (action === "skip") {
        showToast("Movie skipped");
      }

      // Update genre boosts/penalties
      const gf = GENRE_FILTERS.find((g) => g.label === movie.genre);
      if (gf) {
        if (action === "skip") {
          setGenrePenalties((prev) => ({ ...prev, [gf.id]: (prev[gf.id] || 0) + 3 }));
        } else if (action === "save") {
          setGenreBoosts((prev) => ({ ...prev, [gf.id]: (prev[gf.id] || 0) + 5 }));
        }
      }

      setSwipeCount((c) => c + 1);
      setUndoHistory((prev) => [{ movie, action, index: currentIndex }, ...prev].slice(0, 5));
      setCurrentIndex((i) => i + 1);
      setSwipeDir(null);
      setShowStamp(null);
      setDragX(0);
      swipingRef.current = false;
    }, 300);
  }, [movies, currentIndex, savedIds, toggleSave, showToast]);

  // Save from the "Already Watched" mini modal
  const handleWatchedSave = useCallback(() => {
    if (!watchedModal) return;
    toggleWatched(watchedModal);
    setWatchedRating(watchedModal.id, watchedSlider);
    setWatchedModal(null);
    setSwipeCount((c) => c + 1);
    setCurrentIndex((i) => i + 1);
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
    const gf = GENRE_FILTERS.find((g) => g.label === movie.genre);
    if (gf) {
      if (action === "skip") {
        setGenrePenalties((prev) => ({ ...prev, [gf.id]: Math.max(0, (prev[gf.id] || 0) - 3) }));
      } else if (action === "save") {
        setGenreBoosts((prev) => ({ ...prev, [gf.id]: Math.max(0, (prev[gf.id] || 0) - 5) }));
      }
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

  const currentMovie = movies[currentIndex];
  const nextMovie = movies[currentIndex + 1];
  const thirdMovie = movies[currentIndex + 2];
  const rotation = Math.max(-12, Math.min(12, dragX * 0.08));
  const opacity = Math.min(Math.abs(dragX) / 80, 1);
  const tagline = currentMovie ? (cardDetails[currentMovie.id]?.tagline || "") : "";

  // ─── SHUFFLE: self-contained fetch, zero dependencies on other state/refs ───
  const handleShuffle = async () => {
    setLoading(true);
    const page = Math.floor(Math.random() * 100) + 1;
    const apiKey = import.meta.env.VITE_TMDB_API_KEY;
    const url = `https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&vote_average.gte=6.5&vote_count.gte=100&with_original_language=en&sort_by=popularity.desc&page=${page}`;
    console.log("[Discover] Shuffle → page", page);
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const mapped = data.results.filter((m) => m.poster_path).map(tmdbToMovie);
        setMovies(mapped);
        setCurrentIndex(0);
      }
    } catch (e) {
      console.error("Shuffle failed", e);
    } finally {
      setLoading(false);
    }
  };

  // Loading skeleton
  if (loading && movies.length === 0) {
    return (
      <div className="discover-container">
        <div className="discover-header">
          <div className="discover-undo-btn disabled"><UndoIcon /></div>
          <span className="discover-session-count" style={{ opacity: 0.3 }}>0 discovered</span>
          <div className="discover-filter">
            <div className="discover-filter-btn" style={{ opacity: 0.3 }}><FilterIcon /></div>
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

  // Empty / exhausted
  if (!currentMovie && !loading) {
    return (
      <div className="discover-container">
        <div className="discover-empty">
          <div className="discover-empty-icon">
            <DiscoverIcon />
          </div>
          <h3>We've explored every corner</h3>
          <p>Shuffle to load a fresh batch of movies</p>
          <button className="discover-reset-btn" onClick={handleShuffle}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18, marginRight: 6, verticalAlign: -3 }}>
              <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            Shuffle
          </button>
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
      <div className="discover-header">
        <button
          className={`discover-undo-btn ${undoHistory.length === 0 ? "disabled" : ""}`}
          onClick={handleUndo}
          disabled={undoHistory.length === 0}
          title="Undo"
        >
          <UndoIcon />
        </button>
        <span className="discover-session-count">{swipeCount} discovered</span>
        <button className="discover-undo-btn" onClick={handleShuffle} title="Shuffle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
            <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
            <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
            <line x1="4" y1="4" x2="9" y2="9" />
          </svg>
        </button>
        <div className="discover-filter">
          <button className={`discover-filter-btn ${filterOpen ? "active" : ""}`} onClick={() => setFilterOpen(f => !f)} title="Filter genres">
            <FilterIcon />
            {activeGenres.size > 0 && <span className="discover-filter-dot" />}
          </button>
          {filterOpen && (
            <>
              <div className="discover-filter-backdrop" onClick={() => setFilterOpen(false)} />
              <div className="discover-filter-dropdown">
                {DISCOVER_CHIPS.map(g => (
                  <button
                    key={g.id}
                    className={`discover-filter-chip ${activeGenres.has(g.id) ? "active" : ""}`}
                    onClick={() => toggleGenreChip(g.id)}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content: card stack */}
      <div className="discover-content">
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
              className={`discover-card discover-card-active ${swipeDir ? `swipe-${swipeDir}` : ""}`}
              style={{
                transform: swipeDir ? undefined : `translateX(${dragX}px) rotate(${rotation}deg)`,
                transition: isDragging ? "none" : "transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
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
      <div className="discover-actions">
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

// ─── Main App ──────────────────────────────────────────────────────────────────

const MAIN_TAB_ORDER = { search: 0, saved: 1, discover: 2, journal: 3, chat: 4 };

const IS_SHARED_VIEW = new URLSearchParams(window.location.search).has("shared");

export default function App() {
  if (IS_SHARED_VIEW) {
    return <SharedWatchlistView />;
  }
  return <MainApp />;
}

function MainApp() {
  const [activeTab, _setActiveTab] = useState("search");
  const prevTabRef = useRef("search");
  const [tabDir, setTabDir] = useState(null);
  const setActiveTab = useCallback((t) => {
    if (t === prevTabRef.current) return;
    setTabDir(MAIN_TAB_ORDER[t] > MAIN_TAB_ORDER[prevTabRef.current] ? "right" : "left");
    prevTabRef.current = t;
    _setActiveTab(t);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);


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
  const [globalToast, setGlobalToast] = useState(null);
  const globalToastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    clearTimeout(globalToastTimer.current);
    setGlobalToast(msg);
    globalToastTimer.current = setTimeout(() => setGlobalToast(null), 2500);
  }, []);

  const defaultChatId = "default";
  const [chats, setChats] = useState(() => loadFromStorage("cc_chats", [{ id: defaultChatId, title: "New chat", messages: [] }]));
  const [activeChatId, setActiveChatId] = useState(() => loadFromStorage("cc_activeChatId", defaultChatId));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    saveToStorage("cc_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => t === "dark" ? "light" : "dark");

  const clearAllData = () => {
    const keys = ["cc_savedIds", "cc_savedMovies", "cc_watchedIds", "cc_watchedMovies", "cc_watchedNotes", "cc_watchedRatings", "cc_tasteProfile", "cc_aiInsight", "cc_moodPlaylist", "cc_chats", "cc_activeChatId", "cc_collections", "cc_badges", "cc_watchedDates", "cc_discover_swipe_weights", "cc_discover_seen", "cc_discover_maybe_later", "cc_discover_swipe_history", "cc_shownMilestones", "cc_rankSort", "cc_journalSort", "cc_runtimeCache"];
    keys.forEach((k) => localStorage.removeItem(k));
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
    const newId = Date.now().toString();
    setChats([{ id: newId, title: "New chat", messages: [] }]);
    setActiveChatId(newId);
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
      if (next.has(id)) next.delete(id); else next.set(id, movie);
      return next;
    });
    showToast(wasSaved ? "Removed from watchlist" : "Added to watchlist");
  };

  const toggleWatched = (movie) => {
    const id = movie.id;
    const wasWatched = watchedIds.has(id);
    setWatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setWatchedMovies((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id); else next.set(id, movie);
      return next;
    });
    if (!wasWatched) {
      setWatchedDates((prev) => new Map(prev).set(id, new Date().toISOString()));
      // Remove from watchlist and all collections when marking as watched
      const wasSaved = savedIds.has(id);
      if (wasSaved) {
        setSavedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        setSavedMovies((prev) => { const next = new Map(prev); next.delete(id); return next; });
      }
      setCollections((prev) => prev.map((c) =>
        c.movieIds.includes(id) ? { ...c, movieIds: c.movieIds.filter((mid) => mid !== id) } : c
      ));
      showToast("Moved to journal");
    } else {
      setWatchedDates((prev) => { const next = new Map(prev); next.delete(id); return next; });
    }
  };

  const setWatchedNote = (id, text) => {
    setWatchedNotes((prev) => new Map(prev).set(id, text));
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
    setCollections((prev) => [...prev, { id, name, movieIds: [], isDefault: false }]);
    return id;
  };

  const renameCollection = (collectionId, newName) => {
    setCollections((prev) => prev.map((c) => c.id === collectionId ? { ...c, name: newName } : c));
  };

  const deleteCollection = (collectionId) => {
    setCollections((prev) => prev.filter((c) => c.id !== collectionId || c.isDefault));
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

  const startDebrief = (movie) => {
    const chatId = Date.now().toString();
    const rating = watchedRatings.get(movie.id);
    const notes = watchedNotes.get(movie.id);
    const opener = DEBRIEF_OPENERS[Math.floor(Math.random() * DEBRIEF_OPENERS.length)];
    const userMsg = opener(movie.title, rating, notes ? notes.trim() : null);
    setChats((prev) => [{
      id: chatId, title: movie.title, messages: [],
      movieContext: { title: movie.title, year: movie.year, genre: movie.genre, tmdbRating: movie.rating, synopsis: movie.synopsis },
    }, ...prev]);
    setActiveChatId(chatId);
    setActiveTab("chat");
    setDebriefPayload({ chatId, message: userMsg });
  };

  const startMoviePicker = () => {
    const chatId = Date.now().toString();
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

    setChats((prev) => [{
      id: chatId, title: "Movie Picker", messages: [],
      pickerMode: true,
      pickerContext,
    }, ...prev]);
    setActiveChatId(chatId);
    setActiveTab("chat");
  };

  useEffect(() => { saveToStorage("cc_savedIds",     [...savedIds]);     }, [savedIds]);
  useEffect(() => { saveToStorage("cc_savedMovies",  [...savedMovies]);  }, [savedMovies]);
  useEffect(() => { saveToStorage("cc_watchedIds",   [...watchedIds]);   }, [watchedIds]);
  useEffect(() => { saveToStorage("cc_watchedMovies",[...watchedMovies]);}, [watchedMovies]);
  useEffect(() => { saveToStorage("cc_watchedNotes",   [...watchedNotes]);   }, [watchedNotes]);
  useEffect(() => { saveToStorage("cc_watchedRatings", [...watchedRatings]); }, [watchedRatings]);
  useEffect(() => { saveToStorage("cc_tasteProfile",  tasteProfile);      }, [tasteProfile]);
  useEffect(() => { saveToStorage("cc_collections",   collections);       }, [collections]);
  useEffect(() => { saveToStorage("cc_badges",       unlockedBadges);    }, [unlockedBadges]);
  useEffect(() => { saveToStorage("cc_watchedDates", [...watchedDates]); }, [watchedDates]);
  useEffect(() => { saveToStorage("cc_chats",        chats);             }, [chats]);
  useEffect(() => { saveToStorage("cc_activeChatId", activeChatId);      }, [activeChatId]);

  // ── Badge checking effect ──────────────────────────────────
  const badgeToastQueue = useRef([]);
  const badgeToastTimer = useRef(null);

  const showNextToast = useCallback(() => {
    if (badgeToastQueue.current.length === 0) return;
    const badge = badgeToastQueue.current.shift();
    setBadgeToast(badge);
    badgeToastTimer.current = setTimeout(() => {
      setBadgeToast(null);
      setTimeout(() => showNextToast(), 300);
    }, 3000);
  }, []);

  useEffect(() => {
    const ctx = { watchedMovies, watchedRatings, collections, watchedDates };
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
      // Show toast for highest new tier per badge only
      const toastBadges = new Map();
      newlyUnlocked.forEach((tierId) => {
        const badgeId = tierId.replace(/_t\d+$/, "");
        const tierNum = parseInt(tierId.slice(-1));
        if (!toastBadges.has(badgeId) || tierNum > toastBadges.get(badgeId)) {
          toastBadges.set(badgeId, tierNum);
        }
      });
      toastBadges.forEach((tierNum, badgeId) => {
        const badge = BADGE_DEFS.find((b) => b.id === badgeId);
        if (badge) badgeToastQueue.current.push({ ...badge, tierNum });
      });
      if (!badgeToastTimer.current) showNextToast();
    }
  }, [watchedMovies, watchedRatings, collections, watchedDates, unlockedBadges, showNextToast]);

  useEffect(() => () => clearTimeout(badgeToastTimer.current), []);

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

  return (
    <div className="app">
      <div className="header">
        <div className="header-title">
          <div className="logo-mark">C</div>
          Cinno
        </div>
        <div className="header-actions">
          <button className="header-settings-btn" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
        </div>
      </div>

      <div className={`tab-panel ${tabDir ? `slide-${tabDir}` : ""}`} key={activeTab}>
        {activeTab === "search" && (
          <SearchTab savedIds={savedIds} toggleSave={toggleSave} watchedIds={watchedIds} toggleWatched={toggleWatched} startDebrief={startDebrief} collections={collections} toggleMovieInCollection={toggleMovieInCollection} />
        )}
        {activeTab === "saved" && (
          <SavedTab
            savedIds={savedIds} toggleSave={toggleSave} savedMovies={savedMovies}
            watchedIds={watchedIds} toggleWatched={toggleWatched} startDebrief={startDebrief}
            collections={collections} createCollection={createCollection}
            renameCollection={renameCollection} deleteCollection={deleteCollection}
            toggleMovieInCollection={toggleMovieInCollection}
            onStartMoviePicker={startMoviePicker}
            showToast={showToast}
          />
        )}
        {activeTab === "discover" && (
          <DiscoverTab
            savedIds={savedIds} toggleSave={toggleSave}
            watchedIds={watchedIds} toggleWatched={toggleWatched}
            startDebrief={startDebrief}
            collections={collections} toggleMovieInCollection={toggleMovieInCollection}
            watchedMovies={watchedMovies} watchedRatings={watchedRatings}
            setWatchedRating={setWatchedRating}
            showToast={showToast}
          />
        )}
        {activeTab === "journal" && (
          <JournalTab
            watchedMovies={watchedMovies}
            watchedNotes={watchedNotes}
            setWatchedNote={setWatchedNote}
            watchedIds={watchedIds}
            toggleWatched={toggleWatched}
            savedIds={savedIds}
            toggleSave={toggleSave}
            watchedRatings={watchedRatings}
            setWatchedRating={setWatchedRating}
            watchedDates={watchedDates}
            tasteProfile={tasteProfile}
            onSetTasteProfile={setTasteProfile}
            startDebrief={startDebrief}
            unlockedBadges={unlockedBadges}
            collections={collections}
            showToast={showToast}
          />
        )}
        {activeTab === "chat" && (
          <ChatTab
            chats={chats} setChats={setChats} activeChatId={activeChatId} setActiveChatId={setActiveChatId}
            tasteProfile={tasteProfile}
            debriefPayload={debriefPayload} onDebriefHandled={() => setDebriefPayload(null)}
          />
        )}
      </div>

      <div className="tab-bar">
        {tabs.map((tab) => (
          <button key={tab.id} className={`tab-item ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
            {activeTab === tab.id && <div className="tab-indicator" />}
            <tab.icon />
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onClearData={clearAllData}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
      )}

      <BadgeToast badge={badgeToast} visible={!!badgeToast} />
      <MilestoneCelebration milestone={activeMilestone} onDismiss={() => setActiveMilestone(null)} />
      <GlobalToast message={globalToast} />
    </div>
  );
}
