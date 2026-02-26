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

export async function getSimilar(movieId) {
  const data = await tmdbFetch(`/movie/${movieId}/recommendations`);
  return data.results.slice(0, 12).map(tmdbToMovie);
}

export async function discoverByGenres(genreIds, page = 1) {
  const data = await tmdbFetch("/discover/movie", {
    with_genres: genreIds.join(","),
    sort_by: "popularity.desc",
    page,
  });
  return { movies: data.results.map(tmdbToMovie), totalPages: data.total_pages };
}
