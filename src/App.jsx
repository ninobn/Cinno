import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { getTrending, getPopular, getTopRated, getSimilar, searchMovies, discoverByGenres, IMG_BASE } from "./tmdb.js";

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

const GENRE_COLORS = {
  Action: "#b8a088", Adventure: "#a0b88b", Animation: "#8bc4a0", Comedy: "#c4b88b",
  Crime: "#c49b9b", Documentary: "#8ba0b8", Drama: "#8b9dc3", Family: "#b8a0c4",
  Fantasy: "#b39ddb", History: "#a09b8b", Horror: "#9e7e7e", Music: "#9db8c4",
  Mystery: "#a0887e", Romance: "#c48b9f", "Sci-Fi": "#7eb8b8", Thriller: "#9b8ec4",
  War: "#8a9a7b", Western: "#b89a6e", Film: "#8e90a0",
};

const ALL_SUGGESTIONS = [
  "Recommend a thriller", "Explain Inception's ending", "Movies like Parasite",
  "Best films of the 90s", "Hidden gem dramas", "What should I watch tonight?",
  "Movies with great soundtracks", "Underrated sci-fi films", "Best animated movies ever",
  "Movies like Interstellar", "Dark comedies worth watching", "Classic noir films",
  "Must-see foreign films", "Best ensemble casts", "Movies that make you think",
  "Feel-good films to rewatch",
];

const CATEGORIES = [
  { key: "trending",  label: "Trending This Week" },
  { key: "popular",   label: "Popular Right Now"  },
  { key: "top_rated", label: "Top Rated"          },
];

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
        fontFamily="Outfit, sans-serif"
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

// ─── Shared Components ─────────────────────────────────────────────────────────

function PosterImage({ posterPath, title }) {
  if (!posterPath) return <span className="movie-poster-fallback">🎬</span>;
  return <img src={`${IMG_BASE}/w342${posterPath}`} alt={title} loading="lazy" />;
}

function MovieTile({ movie, onClick, isSaved, onToggleSave }) {
  const ratingColor = getRatingColor(movie.rating);
  const genreColor = GENRE_COLORS[movie.genre] || "#8e90a0";
  return (
    <div className="movie-tile" onClick={onClick} style={{ animationDelay: `${(movie._idx || 0) * 25}ms` }}>
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

function MovieModal({ movie, onClose, isSaved, onToggleSave, onMovieSelect, savedIds, isWatched, onToggleWatched }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#8e90a0";
  const ratingColor = getRatingColor(movie.rating);
  const [tab, setTab] = useState("overview");
  const [similar, setSimilar] = useState([]);
  const [similarLoaded, setSimilarLoaded] = useState(false);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

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

  return (
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="movie-modal movie-modal-lg" onClick={(e) => e.stopPropagation()}>
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
              <div className="modal-actions">
                <button className={`modal-save-btn ${isSaved ? "saved" : ""}`} onClick={() => onToggleSave(movie)}>
                  <BookmarkIcon />
                  {isSaved ? "Saved" : "Save"}
                </button>
                <button className={`modal-watch-btn ${isWatched ? "watched" : ""}`} onClick={() => onToggleWatched(movie)}>
                  <EyeIcon />
                  {isWatched ? "Watched" : "Mark watched"}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-tabs">
            <button className={`modal-tab ${tab === "overview" ? "active" : ""}`} onClick={() => handleTabSwitch("overview")}>Overview</button>
            <button className={`modal-tab ${tab === "similar" ? "active" : ""}`} onClick={() => handleTabSwitch("similar")}>Similar to this</button>
          </div>
          {tab === "overview" && (
            <p className="modal-synopsis">{movie.synopsis}</p>
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
  );
}

function JournalDetailModal({ movie, onClose, note, onSaveNote, isSaved, onToggleSave, onToggleWatched, rating, onSetRating }) {
  const genreColor = GENRE_COLORS[movie.genre] || "#8e90a0";
  const ratingColor = getRatingColor(movie.rating);
  const [tab, setTab] = useState("overview");
  const [noteText, setNoteText] = useState(note || "");
  const backdropUrl = movie.backdrop_path ? `${IMG_BASE}/w780${movie.backdrop_path}` : null;

  const saveNote = useCallback(() => onSaveNote(movie.id, noteText), [movie.id, noteText, onSaveNote]);

  const handleTabSwitch = (t) => {
    if (tab === "notes") saveNote();
    setTab(t);
  };

  return (
    <div className="movie-modal-overlay" onClick={onClose}>
      <div className="movie-modal movie-modal-lg" onClick={(e) => e.stopPropagation()}>
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
              <div className="modal-actions">
                <button className={`modal-save-btn ${isSaved ? "saved" : ""}`} onClick={() => onToggleSave(movie)}>
                  <BookmarkIcon />
                  {isSaved ? "Saved" : "Save"}
                </button>
                <button className="modal-watch-btn watched" onClick={() => onToggleWatched(movie)}>
                  <EyeIcon />
                  Watched
                </button>
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
          {tab === "overview" && (
            <p className="modal-synopsis">{movie.synopsis}</p>
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
  );
}

// ─── Search Tab ────────────────────────────────────────────────────────────────

function SearchTab({ savedIds, toggleSave, watchedIds, toggleWatched }) {
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [moviesLoading, setMoviesLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchPage, setSearchPage] = useState(1);
  const [searchTotalPages, setSearchTotalPages] = useState(1);
  const [selectedGenres, setSelectedGenres] = useState([]);
  const [genreDropdownOpen, setGenreDropdownOpen] = useState(false);
  const [topRatedMovies, setTopRatedMovies] = useState([]);
  const [topRatedLoading, setTopRatedLoading] = useState(true);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const searchTimeout = useRef(null);
  const genreDropdownRef = useRef(null);

  const toggleGenre = (id) => {
    setSelectedGenres((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  };

  const fetchBrowse = useCallback(async (idx, genres, pg = 1) => {
    if (pg === 1) setMoviesLoading(true);
    else setLoadingMore(true);
    try {
      let result;
      if (genres.length > 0) {
        result = await discoverByGenres(genres, pg);
      } else {
        const key = CATEGORIES[idx].key;
        if (key === "trending") result = await getTrending(pg);
        else if (key === "popular") result = await getPopular(pg);
        else result = await getTopRated(pg);
      }
      if (pg === 1) setMovies(result.movies || []);
      else setMovies((prev) => [...prev, ...(result.movies || [])]);
      setPage(pg);
      setTotalPages(result.totalPages || 1);
    } catch (e) {
      console.error("Browse fetch failed:", e);
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
    } catch (e) {
      console.error("Load more search failed:", e);
    } finally {
      setLoadingMore(false);
    }
  };

  // Fetch the static top-rated section once on mount
  useEffect(() => {
    getTopRated(1)
      .then((r) => { setTopRatedMovies(r.movies.slice(0, 12)); setTopRatedLoading(false); })
      .catch(() => setTopRatedLoading(false));
  }, []);

  // Re-fetch browse whenever category or genre selection changes
  useEffect(() => {
    fetchBrowse(categoryIdx, selectedGenres, 1);
  }, [categoryIdx, selectedGenres, fetchBrowse]);

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
      } catch (e) {
        console.error("Search failed:", e);
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
    : CATEGORIES[categoryIdx].label;

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
        {!isSearching && !isGenreFiltered && (
          <div className="category-pills">
            {CATEGORIES.map((cat, idx) => (
              <button
                key={cat.key}
                className={`category-pill ${categoryIdx === idx ? "active" : ""}`}
                onClick={() => setCategoryIdx(idx)}
              >
                {cat.label}
              </button>
            ))}
          </div>
        )}
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
      <div className="content">
        {!isSearching && <div className="section-label">{browseLabel}</div>}
        {isSearching && !loading && (
          <div className="results-label">
            {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{query}"
          </div>
        )}
        {(loading || moviesLoading) && displayMovies.length === 0 ? (
          <div className="loading-container"><div className="loading-spinner" /></div>
        ) : displayMovies.length === 0 && isSearching ? (
          <div className="no-results">
            <div className="no-results-icon">🎬</div>
            <p>No movies found for "{query}"</p>
          </div>
        ) : (
          <>
            <div className="movies-grid">
              {displayMovies.map((movie, i) => (
                <MovieTile
                  key={movie.id}
                  movie={{ ...movie, _idx: i % 20 }}
                  isSaved={savedIds.has(movie.id)}
                  onToggleSave={toggleSave}
                  onClick={() => setSelectedMovie(movie)}
                />
              ))}
            </div>
            {canLoadMore && !loading && !moviesLoading && (
              <div className="load-more-container">
                <button
                  className="load-more-btn"
                  onClick={isSearching ? loadMoreSearch : () => fetchBrowse(categoryIdx, selectedGenres, page + 1)}
                  disabled={loadingMore}
                >
                  {loadingMore
                    ? <div className="loading-spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                    : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
        {!isSearching && !isGenreFiltered && (
          <>
            <div className="section-label" style={{ marginTop: 32 }}>Top Rated of All Time</div>
            {topRatedLoading ? (
              <div className="loading-container"><div className="loading-spinner" /></div>
            ) : (
              <div className="movies-grid">
                {topRatedMovies.map((movie, i) => (
                  <MovieTile
                    key={movie.id}
                    movie={{ ...movie, _idx: i }}
                    isSaved={savedIds.has(movie.id)}
                    onToggleSave={toggleSave}
                    onClick={() => setSelectedMovie(movie)}
                  />
                ))}
              </div>
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
        />
      )}
    </>
  );
}

// ─── Saved Tab ─────────────────────────────────────────────────────────────────

function SavedTab({ savedIds, toggleSave, savedMovies, watchedIds, toggleWatched }) {
  const [selectedMovie, setSelectedMovie] = useState(null);
  const movies = useMemo(
    () => Array.from(savedMovies.values()).map((m, i) => ({ ...m, _idx: i })),
    [savedMovies]
  );

  if (movies.length === 0) {
    return (
      <div className="content">
        <div className="saved-empty">
          <div className="saved-icon">🔖</div>
          <div className="saved-title">Your watchlist is empty</div>
          <div className="saved-desc">Hover over any movie and tap the bookmark icon to add it to your watchlist.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="content">
        <div className="results-label">{movies.length} movie{movies.length !== 1 ? "s" : ""} in your watchlist</div>
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
        />
      )}
    </>
  );
}

// ─── Stats View ────────────────────────────────────────────────────────────────

function StatsView({ watchedMovies, watchedRatings }) {
  const statsRef = useRef(null);

  const stats = useMemo(() => {
    const totalMovies = watchedMovies.size;
    const totalHours = totalMovies * 2;

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

    return {
      totalMovies, totalHours,
      highest: highest ? { movie: highest, score: highScore } : null,
      lowest: lowest ? { movie: lowest, score: lowScore } : null,
      genres,
    };
  }, [watchedMovies, watchedRatings]);

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

  const totalGenres = stats.genres.reduce((sum, g) => sum + g.count, 0);
  const donutSize = 140;
  const strokeWidth = 24;
  const radius = (donutSize - strokeWidth) / 2;
  const cx = donutSize / 2;
  const cy = donutSize / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativeOffset = 0;
  const arcs = stats.genres.map((g) => {
    const pct = g.count / totalGenres;
    const dashLen = circumference * pct;
    const rotation = (cumulativeOffset / totalGenres) * 360 - 90;
    cumulativeOffset += g.count;
    const color = GENRE_COLORS[g.name] || "#8e90a0";
    return { ...g, dashLen, rotation, color };
  });

  return (
    <div className="stats-grid" ref={statsRef}>
      <div className="stats-card full">
        <div className="stats-big-number">{stats.totalMovies}</div>
        <div className="stats-subtitle">
          that's {stats.totalHours} hours of cinema
        </div>
      </div>

      {stats.highest && stats.lowest && (
        <>
          <div className="stats-card">
            <div className="stats-card-label">Highest Rated</div>
            <div className="stats-card-movie">
              <div className="stats-card-poster">
                <PosterImage posterPath={stats.highest.movie.poster_path} title={stats.highest.movie.title} />
              </div>
              <div className="stats-card-info">
                <div className="stats-card-title">{stats.highest.movie.title}</div>
                <ScoreRing score={stats.highest.score} size={44} />
              </div>
            </div>
          </div>
          <div className="stats-card">
            <div className="stats-card-label">Lowest Rated</div>
            <div className="stats-card-movie">
              <div className="stats-card-poster">
                <PosterImage posterPath={stats.lowest.movie.poster_path} title={stats.lowest.movie.title} />
              </div>
              <div className="stats-card-info">
                <div className="stats-card-title">{stats.lowest.movie.title}</div>
                <ScoreRing score={stats.lowest.score} size={44} />
              </div>
            </div>
          </div>
        </>
      )}

      {stats.genres.length > 0 && (
        <div className="stats-card full">
          <div className="stats-card-label">Genre Breakdown</div>
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
          <div className="stats-legend">
            {stats.genres.map((g) => (
              <div key={g.name} className="stats-legend-item">
                <span className="stats-legend-dot" style={{ background: GENRE_COLORS[g.name] || "#8e90a0" }} />
                <span className="stats-legend-name">{g.name}</span>
                <span className="stats-legend-count">{g.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Journal Tab ───────────────────────────────────────────────────────────────

function JournalTab({ watchedMovies, watchedNotes, setWatchedNote, watchedIds, toggleWatched, savedIds, toggleSave, watchedRatings, setWatchedRating, tasteProfile, onSetTasteProfile }) {
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [view, setView] = useState("journal");
  const [generatingProfile, setGeneratingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");

  const movies = useMemo(
    () => Array.from(watchedMovies.values()).map((m, i) => ({ ...m, _idx: i })),
    [watchedMovies]
  );

  const rankedMovies = useMemo(
    () => movies
      .filter((m) => watchedRatings.has(m.id))
      .sort((a, b) => watchedRatings.get(b.id) - watchedRatings.get(a.id)),
    [movies, watchedRatings]
  );

  const handleToggleWatched = (movie) => {
    toggleWatched(movie);
    setSelectedMovie(null);
  };

  const generateProfile = async () => {
    setGeneratingProfile(true);
    setProfileError("");
    try {
      const lines = Array.from(watchedMovies.values()).map((m) => {
        const score = watchedRatings.get(m.id);
        return `${m.title} (${m.genre}, ${m.year})${score ? ` — rated ${score}/100` : ""}`;
      });
      const prompt = `Based on these movies the user has watched and rated, write a brief 2-3 sentence taste profile describing their movie preferences. Be specific and insightful — focus on patterns in genre, tone, era, and themes. Write in second person ("You tend to..."). Movies: ${lines.join(", ")}`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || "API error");
      const text = data.content?.[0]?.text?.trim();
      if (text) onSetTasteProfile(text);
    } catch (e) {
      setProfileError(e.message || "Failed to generate. Check your API key.");
    } finally {
      setGeneratingProfile(false);
    }
  };

  if (movies.length === 0) {
    return (
      <div className="content">
        <div className="saved-empty">
          <div className="saved-icon">🎞️</div>
          <div className="saved-title">Your journal is empty</div>
          <div className="saved-desc">Tap "Mark watched" in any movie's detail view to log it here and write your thoughts.</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="content">
        <div className="journal-toggle">
          <button className={`journal-toggle-btn ${view === "journal" ? "active" : ""}`} onClick={() => setView("journal")}>Journal</button>
          <button className={`journal-toggle-btn ${view === "rankings" ? "active" : ""}`} onClick={() => setView("rankings")}>Rankings</button>
          <button className={`journal-toggle-btn ${view === "stats" ? "active" : ""}`} onClick={() => setView("stats")}>Stats</button>
        </div>

        <div className="taste-profile-card">
          {tasteProfile ? (
            <p className="taste-profile-text">{tasteProfile}</p>
          ) : (
            <p className="taste-profile-empty">Generate an AI taste profile based on your watched movies and ratings.</p>
          )}
          <div className="taste-profile-footer">
            <button className="taste-profile-btn" onClick={generateProfile} disabled={generatingProfile}>
              {generatingProfile
                ? <><div className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Generating…</>
                : tasteProfile ? "Regenerate" : "Generate taste profile"}
            </button>
            {profileError && <span className="taste-profile-error">{profileError}</span>}
          </div>
        </div>

        {view === "journal" && (
          <>
            <div className="results-label">{movies.length} watched movie{movies.length !== 1 ? "s" : ""}</div>
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
          </>
        )}

        {view === "rankings" && (
          <>
            <div className="results-label">{rankedMovies.length} rated movie{rankedMovies.length !== 1 ? "s" : ""}</div>
            {rankedMovies.length === 0 ? (
              <div className="rankings-empty">Rate movies in your journal to see them ranked here.</div>
            ) : (
              <div className="rankings-list">
                {rankedMovies.map((movie, i) => (
                  <div
                    key={movie.id}
                    className="ranking-item"
                    onClick={() => setSelectedMovie(movie)}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <span className={`ranking-num ${i < 3 ? "top3" : ""}`}>#{i + 1}</span>
                    <div className="ranking-poster">
                      <PosterImage posterPath={movie.poster_path} title={movie.title} />
                    </div>
                    <div className="ranking-info">
                      <div className="ranking-title">{movie.title}</div>
                      <div className="ranking-meta">{movie.genre} · {movie.year}</div>
                    </div>
                    <ScoreRing score={watchedRatings.get(movie.id)} size={44} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === "stats" && (
          <StatsView watchedMovies={watchedMovies} watchedRatings={watchedRatings} />
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
        />
      )}
    </>
  );
}

// ─── Chat Tab ──────────────────────────────────────────────────────────────────

function ChatTab({ chats, setChats, activeChatId, setActiveChatId, tasteProfile }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const activeChat = chats.find((c) => c.id === activeChatId);
  const messages = activeChat ? activeChat.messages : [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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

  const sendMessage = async (text) => {
    const userMsg = text || input.trim();
    if (!userMsg || loading) return;

    setInput("");
    setError("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    const newMessages = [...messages, { role: "user", content: userMsg }];
    updateMessages(newMessages);
    const isFirstMessage = messages.length === 0;
    setLoading(true);

    try {
      const personalContext = tasteProfile ? `The user's taste profile: ${tasteProfile}` : "";
      const movieContext = `You are a knowledgeable movie companion. Help users with movie recommendations, plot explanations, character analysis, and post-watch debriefing. Be conversational and concise. Never use emojis, markdown bold, headers, horizontal rules or bullet points. Write in plain natural sentences and short paragraphs. No lists - just talk naturally like a friend who knows a lot about movies. Keep responses to 2-3 short paragraphs max. When the user asks for recommendations without being specific, ask all your clarifying questions in ONE message. For example, ask what vibe/genre they want, what mood they're in, any movies they already love, and whether they want something new or classic - all in one short message. Never ask follow up questions across multiple messages. Once you have enough info, give your recommendations immediately.${personalContext ? "\n\n" + personalContext : ""}`;

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
      updateMessages([...newMessages, { role: "assistant", content: assistantText }]);

      if (isFirstMessage) generateTitle(userMsg, assistantText);
    } catch (err) {
      setError(err.message || "Couldn't connect. Check your API key and try again.");
      console.error("Chat error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

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

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="chat-topbar">
          <button className="chat-menu-btn" onClick={() => setSidebarOpen(true)}><MenuIcon /></button>
          <span className="chat-topbar-title">{activeChat?.title || "New chat"}</span>
          <button className="chat-topbar-new" onClick={createNewChat} title="New chat">+</button>
        </div>

        <div className="chat-messages">
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
                <div key={i} className={`msg msg-${msg.role}`}>
                  <div className="msg-avatar">
                    {msg.role === "assistant" ? <BotIcon /> : <PersonIcon />}
                  </div>
                  <div className="msg-bubble">
                    {msg.content.split("\n").map((line, j) => (
                      <span key={j}>{line}{j < msg.content.split("\n").length - 1 && <br />}</span>
                    ))}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="msg msg-assistant">
                  <div className="msg-avatar"><BotIcon /></div>
                  <div className="msg-bubble"><div className="msg-typing"><span /><span /><span /></div></div>
                </div>
              )}
            </>
          )}
          {error && <div className="chat-error">{error}</div>}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-container">
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

// ─── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState("search");
  const [savedIds, setSavedIds] = useState(() => new Set(loadFromStorage("cc_savedIds", [])));
  const [savedMovies, setSavedMovies] = useState(() => new Map(loadFromStorage("cc_savedMovies", [])));
  const [watchedIds, setWatchedIds] = useState(() => new Set(loadFromStorage("cc_watchedIds", [])));
  const [watchedMovies, setWatchedMovies] = useState(() => new Map(loadFromStorage("cc_watchedMovies", [])));
  const [watchedNotes, setWatchedNotes] = useState(() => new Map(loadFromStorage("cc_watchedNotes", [])));
  const [watchedRatings, setWatchedRatings] = useState(() => new Map(loadFromStorage("cc_watchedRatings", [])));
  const [tasteProfile, setTasteProfile] = useState(() => loadFromStorage("cc_tasteProfile", ""));

  const defaultChatId = "default";
  const [chats, setChats] = useState(() => loadFromStorage("cc_chats", [{ id: defaultChatId, title: "New chat", messages: [] }]));
  const [activeChatId, setActiveChatId] = useState(() => loadFromStorage("cc_activeChatId", defaultChatId));

  const toggleSave = (movie) => {
    const id = movie.id;
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
  };

  const toggleWatched = (movie) => {
    const id = movie.id;
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

  useEffect(() => { saveToStorage("cc_savedIds",     [...savedIds]);     }, [savedIds]);
  useEffect(() => { saveToStorage("cc_savedMovies",  [...savedMovies]);  }, [savedMovies]);
  useEffect(() => { saveToStorage("cc_watchedIds",   [...watchedIds]);   }, [watchedIds]);
  useEffect(() => { saveToStorage("cc_watchedMovies",[...watchedMovies]);}, [watchedMovies]);
  useEffect(() => { saveToStorage("cc_watchedNotes",   [...watchedNotes]);   }, [watchedNotes]);
  useEffect(() => { saveToStorage("cc_watchedRatings", [...watchedRatings]); }, [watchedRatings]);
  useEffect(() => { saveToStorage("cc_tasteProfile",  tasteProfile);      }, [tasteProfile]);
  useEffect(() => { saveToStorage("cc_chats",        chats);             }, [chats]);
  useEffect(() => { saveToStorage("cc_activeChatId", activeChatId);      }, [activeChatId]);

  const tabs = [
    { id: "search",  label: "Search",  icon: SearchIcon    },
    { id: "saved",   label: "Watchlist", icon: BookmarkIcon  },
    { id: "journal", label: "Journal", icon: FilmStripIcon },
    { id: "chat",    label: "Chat",    icon: ChatIcon      },
  ];

  return (
    <div className="app">
      <div className="header">
        <div className="header-title">
          <div className="logo-mark">C</div>
          Cinno
          <span>beta</span>
        </div>
      </div>

      {activeTab === "search" && (
        <SearchTab savedIds={savedIds} toggleSave={toggleSave} watchedIds={watchedIds} toggleWatched={toggleWatched} />
      )}
      {activeTab === "saved" && (
        <SavedTab savedIds={savedIds} toggleSave={toggleSave} savedMovies={savedMovies} watchedIds={watchedIds} toggleWatched={toggleWatched} />
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
          tasteProfile={tasteProfile}
          onSetTasteProfile={setTasteProfile}
        />
      )}
      {activeTab === "chat" && (
        <ChatTab
          chats={chats} setChats={setChats} activeChatId={activeChatId} setActiveChatId={setActiveChatId}
          tasteProfile={tasteProfile}
        />
      )}

      <div className="tab-bar">
        {tabs.map((tab) => (
          <button key={tab.id} className={`tab-item ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
            {activeTab === tab.id && <div className="tab-indicator" />}
            <tab.icon />
            <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
