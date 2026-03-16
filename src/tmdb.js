const TMDB_KEY = import.meta.env.VITE_TMDB_API_KEY;
const BASE = "https://api.themoviedb.org/3";
export const IMG_BASE = "https://image.tmdb.org/t/p";

const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

export function tmdbToMovie(m) {
  const genre = m.genre_ids?.length ? (GENRE_MAP[m.genre_ids[0]] || "Film") : "Film";
  return {
    id: m.id,
    title: m.title || m.name || "Untitled",
    year: (m.release_date || "").slice(0, 4) || "—",
    rating: m.vote_average ? m.vote_average.toFixed(1) : "—",
    genre,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    synopsis: m.overview || "No description available.",
  };
}

async function tmdbFetch(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  url.searchParams.set("api_key", TMDB_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`TMDB error: ${resp.status}`);
  return resp.json();
}

export async function getTrending(page = 1) {
  const data = await tmdbFetch("/trending/movie/week", { page });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function searchMovies(query, page = 1) {
  if (!query.trim()) return { movies: [], totalPages: 0 };
  const data = await tmdbFetch("/search/movie", { query, page });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getPopular(page = 1) {
  const data = await tmdbFetch("/movie/popular", { page });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getTopRated(page = 1) {
  const data = await tmdbFetch("/movie/top_rated", { page });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getNowPlaying(page = 1) {
  const data = await tmdbFetch("/movie/now_playing", { page });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getMovieDetails(movieId) {
  return tmdbFetch(`/movie/${movieId}`);
}

export async function getSimilar(movieId) {
  const data = await tmdbFetch(`/movie/${movieId}/recommendations`);
  return data.results.slice(0, 12).map(tmdbToMovie);
}

export async function getHiddenGems(page = 1) {
  const data = await tmdbFetch("/discover/movie", {
    "vote_average.gte": "7.5",
    "vote_count.gte": "50",
    "vote_count.lte": "500",
    sort_by: "vote_average.desc",
    page,
  });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getWatchProviders(movieId, region = "TH") {
  const data = await tmdbFetch(`/movie/${movieId}/watch/providers`);
  const country = data.results?.[region];
  if (!country) return [];
  const all = [...(country.flatrate || []), ...(country.ads || []), ...(country.buy || []), ...(country.rent || [])];
  const seen = new Set();
  return all.filter((p) => {
    if (seen.has(p.provider_id)) return false;
    seen.add(p.provider_id);
    return true;
  });
}

const GENRE_MAP_FULL = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

export async function getMovieById(movieId) {
  const m = await tmdbFetch(`/movie/${movieId}`);
  const genre = m.genres?.length ? (GENRE_MAP_FULL[m.genres[0].id] || m.genres[0].name || "Film") : "Film";
  return {
    id: m.id,
    title: m.title || "Untitled",
    year: (m.release_date || "").slice(0, 4) || "—",
    rating: m.vote_average ? m.vote_average.toFixed(1) : "—",
    genre,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    synopsis: m.overview || "No description available.",
  };
}

export async function discoverByGenres(genreIds, page = 1) {
  const data = await tmdbFetch("/discover/movie", {
    with_genres: genreIds.join(","),
    sort_by: "popularity.desc",
    page,
  });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getMovieKeywords(movieId) {
  const data = await tmdbFetch(`/movie/${movieId}/keywords`);
  return data.keywords || [];
}

export async function discoverMovies(params = {}, page = 1) {
  const data = await tmdbFetch("/discover/movie", { ...params, page });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}

export async function getMovieCredits(movieId) {
  return tmdbFetch(`/movie/${movieId}/credits`);
}

export async function getMovieReviews(movieId) {
  return tmdbFetch(`/movie/${movieId}/reviews`);
}

export async function getSmartContext(query) {
  try {
    const search = await tmdbFetch("/search/movie", { query });
    const movie = search.results?.[0];
    if (!movie) return null;

    const [details, credits, reviews, similar] = await Promise.all([
      tmdbFetch(`/movie/${movie.id}`),
      tmdbFetch(`/movie/${movie.id}/credits`),
      tmdbFetch(`/movie/${movie.id}/reviews`),
      tmdbFetch(`/movie/${movie.id}/similar`),
    ]);

    const director = credits.crew?.find((c) => c.job === "Director")?.name || "Unknown";
    const cast = credits.cast?.slice(0, 10).map((c) => c.name).join(", ") || "Unknown";
    const reviewSnippets = (reviews.results || []).slice(0, 3).map((r) => r.content?.slice(0, 200)).filter(Boolean);
    const similarTitles = (similar.results || []).slice(0, 5).map((m) => m.title).filter(Boolean);
    const year = (details.release_date || "").slice(0, 4);

    return {
      found: true,
      title: details.title,
      year,
      context: `Movie context: ${details.title} (${year}), directed by ${director}, starring ${cast}. Rating: ${details.vote_average?.toFixed(1) || "N/A"}/10. Runtime: ${details.runtime || "N/A"} min. Budget: $${details.budget?.toLocaleString() || "N/A"}. Revenue: $${details.revenue?.toLocaleString() || "N/A"}. Tagline: "${details.tagline || "None"}". Synopsis: ${details.overview || "N/A"}. User reviews: ${reviewSnippets.length ? reviewSnippets.join(" | ") : "None available"}. Similar movies: ${similarTitles.length ? similarTitles.join(", ") : "None"}.`,
    };
  } catch {
    return null;
  }
}
