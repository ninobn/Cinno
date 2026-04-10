import { supabase } from "../supabase.js";

// ─── Supabase tables ─────────────────────────────────────────────────────────
//
// collections        (id uuid, user_id uuid, name text, is_default bool, created_at)
// collection_movies  (id uuid, collection_id uuid, tmdb_id int, added_at, sort_order int)
// movies_cache       (tmdb_id int PK, title, poster_path, year int, rating numeric,
//                     synopsis text, cached_at)
//
// The default "Watchlist" collection (is_default = true) represents savedIds.
// All other collections are user-created (is_default = false).
// A movie must be in the Watchlist to exist in any other collection.
// ─────────────────────────────────────────────────────────────────────────────

const WATCHLIST_NAME = "Watchlist";

// ─── movies_cache ────────────────────────────────────────────────────────────

export async function upsertMovieCache(movie) {
  if (!supabase || !movie?.id) return;
  try {
    const { error } = await supabase
      .from("movies_cache")
      .upsert({
        tmdb_id: movie.id,
        title: movie.title || "Untitled",
        poster_path: movie.poster_path || null,
        year: movie.year && movie.year !== "—" ? parseInt(movie.year) : null,
        rating: movie.rating && movie.rating !== "—" ? parseFloat(movie.rating) : null,
        synopsis: movie.synopsis || null,
        cached_at: new Date().toISOString(),
      }, { onConflict: "tmdb_id" });
    if (error) throw error;
  } catch (e) {
    console.error("Failed to upsert movies_cache:", e);
  }
}

async function upsertMovieCacheBatch(movies) {
  if (!supabase || !movies?.length) return;
  try {
    const rows = movies.map((m) => ({
      tmdb_id: m.id,
      title: m.title || "Untitled",
      poster_path: m.poster_path || null,
      year: m.year && m.year !== "—" ? parseInt(m.year) : null,
      rating: m.rating && m.rating !== "—" ? parseFloat(m.rating) : null,
      synopsis: m.synopsis || null,
      cached_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("movies_cache")
      .upsert(rows, { onConflict: "tmdb_id" });
    if (error) throw error;
  } catch (e) {
    console.error("Failed to batch upsert movies_cache:", e);
  }
}

// ─── Collections CRUD ────────────────────────────────────────────────────────

export async function ensureDefaultCollection(userId) {
  if (!supabase) throw new Error("No Supabase client");
  // Check if default Watchlist already exists (limit 1 handles duplicates gracefully)
  const { data: existing, error: fetchErr } = await supabase
    .from("collections")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .order("created_at", { ascending: true })
    .limit(1);
  if (fetchErr) throw fetchErr;
  if (existing && existing.length > 0) return existing[0].id;
  // Create it
  const { data, error } = await supabase
    .from("collections")
    .insert({ user_id: userId, name: WATCHLIST_NAME, is_default: true })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function getCollections(userId) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("collections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createCollection(userId, name, isDefault = false) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("collections")
    .insert({ user_id: userId, name, is_default: isDefault })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCollection(collectionId) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("id", collectionId);
  if (error) throw error;
}

export async function renameCollection(collectionId, name) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("collections")
    .update({ name })
    .eq("id", collectionId);
  if (error) throw error;
}

// ─── Collection movies CRUD ──────────────────────────────────────────────────

export async function getCollectionMovies(collectionId) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("collection_movies")
    .select("tmdb_id, sort_order, added_at")
    .eq("collection_id", collectionId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Fetch movie data from cache
  const tmdbIds = data.map((r) => r.tmdb_id);
  const { data: cached, error: cacheErr } = await supabase
    .from("movies_cache")
    .select("*")
    .in("tmdb_id", tmdbIds);
  if (cacheErr) throw cacheErr;

  const cacheMap = {};
  for (const m of cached || []) cacheMap[m.tmdb_id] = m;

  // Return in sort_order, merging cache data
  return data.map((r) => {
    const c = cacheMap[r.tmdb_id];
    return {
      id: r.tmdb_id,
      title: c?.title || "Unknown",
      poster_path: c?.poster_path || null,
      year: c?.year != null ? String(c.year) : "—",
      rating: c?.rating != null ? c.rating.toFixed(1) : "—",
      synopsis: c?.synopsis || "",
      sort_order: r.sort_order,
      added_at: r.added_at,
    };
  });
}

export async function addMovieToCollection(collectionId, movie) {
  if (!supabase) throw new Error("No Supabase client");
  // Upsert into movies_cache first
  await upsertMovieCache(movie);
  // Check if already in collection
  const { data: existing } = await supabase
    .from("collection_movies")
    .select("id")
    .eq("collection_id", collectionId)
    .eq("tmdb_id", movie.id)
    .maybeSingle();
  if (existing) return; // Already exists
  // Get current max sort_order
  const { data: maxRow } = await supabase
    .from("collection_movies")
    .select("sort_order")
    .eq("collection_id", collectionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? -1) + 1;
  const { error } = await supabase
    .from("collection_movies")
    .insert({ collection_id: collectionId, tmdb_id: movie.id, sort_order: nextSort, added_at: new Date().toISOString() });
  if (error) throw error;
}

export async function removeMovieFromCollection(collectionId, tmdbId) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("collection_movies")
    .delete()
    .eq("collection_id", collectionId)
    .eq("tmdb_id", tmdbId);
  if (error) throw error;
}

export async function reorderCollectionMovies(collectionId, tmdbIds) {
  if (!supabase) throw new Error("No Supabase client");
  // Update sort_order for each movie
  const updates = tmdbIds.map((tmdbId, i) =>
    supabase
      .from("collection_movies")
      .update({ sort_order: i })
      .eq("collection_id", collectionId)
      .eq("tmdb_id", tmdbId)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// ─── Bulk load: all collections + their movies + cache data ──────────────────
// Returns { watchlistId, savedIds, savedMovies, collections }
// where savedIds/savedMovies mirror the app's current state shape.

export async function loadFullWatchlistState(userId) {
  if (!supabase) throw new Error("No Supabase client");

  // 1. Get all collections
  const allCollections = await getCollections(userId);
  const defaultCol = allCollections.find((c) => c.is_default);
  if (!defaultCol) throw new Error("No default Watchlist collection found");

  // 2. Query collection_movies per-collection to avoid RLS/join issues
  const cmByCollection = {};
  const allTmdbIdSet = new Set();
  for (const col of allCollections) {
    const { data, error } = await supabase
      .from("collection_movies")
      .select("tmdb_id, sort_order, added_at")
      .eq("collection_id", col.id)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error(`Failed to load movies for collection ${col.name}:`, error);
      cmByCollection[col.id] = [];
      continue;
    }
    cmByCollection[col.id] = data || [];
    for (const r of data || []) allTmdbIdSet.add(r.tmdb_id);
  }

  // 3. Get all movie data from cache (batch by chunks of 200 for large watchlists)
  const allTmdbIds = [...allTmdbIdSet];
  const cacheMap = {};
  for (let i = 0; i < allTmdbIds.length; i += 200) {
    const chunk = allTmdbIds.slice(i, i + 200);
    try {
      const { data: cached, error: cacheErr } = await supabase
        .from("movies_cache")
        .select("*")
        .in("tmdb_id", chunk);
      if (cacheErr) {
        console.error("Failed to load movies_cache chunk:", cacheErr);
        continue;
      }
      for (const m of cached || []) cacheMap[m.tmdb_id] = m;
    } catch (e) {
      console.error("movies_cache query threw:", e);
    }
  }

  // Helper: cache row → app movie object
  const toMovie = (tmdbId) => {
    const c = cacheMap[tmdbId];
    return {
      id: tmdbId,
      title: c?.title || "Unknown",
      poster_path: c?.poster_path || null,
      year: c?.year != null ? String(c.year) : "—",
      rating: c?.rating != null ? c.rating.toFixed(1) : "—",
      synopsis: c?.synopsis || "",
      genre: "Film", // genre not stored in cache — filled on next TMDB fetch
    };
  };

  // 4. Build savedIds / savedMovies from default Watchlist
  const watchlistMovies = cmByCollection[defaultCol.id] || [];
  const savedIds = watchlistMovies.map((r) => r.tmdb_id);
  const savedMovies = watchlistMovies.map((r) => {
    const movie = toMovie(r.tmdb_id);
    movie.savedAt = r.added_at;
    return [r.tmdb_id, movie];
  });

  // 5. Build collections array (non-default only) with movieIds
  const collections = allCollections
    .filter((c) => !c.is_default)
    .map((c) => {
      const movieRows = cmByCollection[c.id] || [];
      return {
        id: c.id,
        name: c.name,
        isDefault: false,
        movieIds: movieRows.map((r) => r.tmdb_id),
      };
    });

  return {
    watchlistId: defaultCol.id,
    savedIds,
    savedMovies,
    collections,
  };
}

// ─── One-time migration: localStorage → Supabase ────────────────────────────
// localData shape: { savedIds: number[], savedMovies: Map entries, collections: array }

export async function migrateLocalWatchlist(userId, localData) {
  if (!supabase) return null;
  try {
    // Skip if user already has collections in Supabase
    const existing = await getCollections(userId);
    if (existing.length > 0) return null;

    // 1. Create default Watchlist
    const watchlistId = await ensureDefaultCollection(userId);

    // 2. Upsert all movie data into cache
    const movieMap = new Map(localData.savedMovies || []);
    const allMovies = Array.from(movieMap.values());
    if (allMovies.length > 0) {
      await upsertMovieCacheBatch(allMovies);
    }

    // 3. Add savedIds to Watchlist collection
    const savedIds = localData.savedIds || [];
    if (savedIds.length > 0) {
      const rows = savedIds.map((tmdbId, i) => ({
        collection_id: watchlistId,
        tmdb_id: tmdbId,
        sort_order: i,
        added_at: new Date().toISOString(),
      }));
      const { error } = await supabase
        .from("collection_movies")
        .insert(rows);
      if (error) console.error("Failed to migrate watchlist movies:", error);
    }

    // 4. Migrate other collections (Favourites, Must Watch, user-created)
    const localCollections = localData.collections || [];
    const migratedCollections = [];
    for (const col of localCollections) {
      // Skip if it somehow is the default — we already handled that
      if (col.name === WATCHLIST_NAME && col.isDefault) continue;
      try {
        // All migrated collections are non-default (including former "Favourites" and "Must Watch")
        const newCol = await createCollection(userId, col.name, false);
        const movieIds = (col.movieIds || []).filter((id) => savedIds.includes(id));
        if (movieIds.length > 0) {
          const rows = movieIds.map((tmdbId, i) => ({
            collection_id: newCol.id,
            tmdb_id: tmdbId,
            sort_order: i,
            added_at: new Date().toISOString(),
          }));
          const { error } = await supabase
            .from("collection_movies")
            .insert(rows);
          if (error) console.error("Failed to migrate collection movies:", col.name, error);
        }
        migratedCollections.push({ oldId: col.id, newId: newCol.id, name: col.name });
      } catch (e) {
        console.error("Failed to migrate collection:", col.name, e);
      }
    }

    return { watchlistId, migratedCollections };
  } catch (e) {
    console.error("Failed to migrate local watchlist to Supabase:", e);
    return null;
  }
}
