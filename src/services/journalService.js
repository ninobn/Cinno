import { supabase } from "../supabase.js";
import { upsertMovieCache } from "./watchlistService.js";

// ─── Supabase table ─────────────────────────────────────────────────────────
//
// journal_entries  (id uuid PK, user_id uuid FK, tmdb_id int, rank_position int?,
//                   personal_rating numeric?, watch_date timestamptz?,
//                   notes text?, created_at, updated_at)
//   Unique constraint on (user_id, tmdb_id).
//
// Joined with movies_cache (tmdb_id PK) to return full movie data.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getJournalEntries(userId) {
  if (!supabase) throw new Error("No Supabase client");
  // Get journal entries ordered by rank
  const { data: entries, error } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("user_id", userId)
    .order("rank_position", { ascending: true, nullsFirst: false });
  if (error) throw error;
  if (!entries || entries.length === 0) return [];

  // Fetch movie data from cache
  const tmdbIds = entries.map((e) => e.tmdb_id);
  const cacheMap = await fetchMovieCache(tmdbIds);

  return entries.map((e) => mergeEntryWithCache(e, cacheMap));
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function addJournalEntry(userId, movie, { rankPosition, personalRating, watchDate, notes } = {}) {
  if (!supabase) throw new Error("No Supabase client");
  // Upsert movie into cache — must succeed before journal insert (FK constraint)
  await ensureMovieCached(movie);

  const { data, error } = await supabase
    .from("journal_entries")
    .upsert({
      user_id: userId,
      tmdb_id: movie.id,
      rank_position: rankPosition ?? null,
      personal_rating: personalRating ?? null,
      watch_date: watchDate ?? null,
      notes: notes ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id, tmdb_id" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateJournalEntry(entryId, fields) {
  if (!supabase) throw new Error("No Supabase client");
  const allowed = {};
  if ("rankPosition" in fields) allowed.rank_position = fields.rankPosition;
  if ("personalRating" in fields) allowed.personal_rating = fields.personalRating;
  if ("watchDate" in fields) allowed.watch_date = fields.watchDate;
  if ("notes" in fields) allowed.notes = fields.notes;
  allowed.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("journal_entries")
    .update(allowed)
    .eq("id", entryId);
  if (error) throw error;
}

export async function deleteJournalEntry(entryId) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", entryId);
  if (error) throw error;
}

// ─── Reorder ─────────────────────────────────────────────────────────────────

export async function reorderJournal(userId, tmdbIdOrder) {
  if (!supabase) throw new Error("No Supabase client");
  const updates = tmdbIdOrder.map((tmdbId, i) =>
    supabase
      .from("journal_entries")
      .update({ rank_position: i, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

// ─── Bulk load: hydrate full React state ─────────────────────────────────────
// Returns: { watchedIds, watchedMovies, watchedRatings, watchedDates, watchedNotes, rankedOrder }

export async function loadFullJournalState(userId) {
  if (!supabase) throw new Error("No Supabase client");

  const { data: entries, error } = await supabase
    .from("journal_entries")
    .select("*")
    .eq("user_id", userId)
    .order("rank_position", { ascending: true, nullsFirst: false });
  if (error) throw error;

  const rawCount = entries?.length ?? 0;
  console.log(`[Journal] Supabase returned ${rawCount} journal_entries rows`);

  if (!entries || entries.length === 0) {
    return {
      watchedIds: [],
      watchedMovies: [],
      watchedRatings: [],
      watchedDates: [],
      watchedNotes: [],
      rankedOrder: [],
      entryIdMap: [],
    };
  }

  // Fetch movie data from cache (best-effort — entries render regardless)
  const tmdbIds = entries.map((e) => e.tmdb_id);
  const cacheMap = await fetchMovieCache(tmdbIds);
  const cacheHits = tmdbIds.filter((id) => id in cacheMap).length;
  if (cacheHits < rawCount) {
    console.warn(`[Journal] movies_cache has ${cacheHits}/${rawCount} entries — ${rawCount - cacheHits} will show as "Unknown"`);
  }

  // Build the structures React state expects — every entry is included
  const watchedIds = [];
  const watchedMovies = [];
  const watchedRatings = [];
  const watchedDates = [];
  const watchedNotes = [];
  const rankedOrder = [];
  const entryIdMap = [];

  for (const entry of entries) {
    const id = entry.tmdb_id;
    const c = cacheMap[id];

    watchedIds.push(id);
    entryIdMap.push([id, entry.id]);

    watchedMovies.push([id, {
      id,
      title: c?.title || "Unknown",
      poster_path: c?.poster_path || null,
      year: c?.year != null ? String(c.year) : "\u2014",
      rating: c?.rating != null ? c.rating.toFixed(1) : "\u2014",
      synopsis: c?.synopsis || "",
      genre: "Film",
    }]);

    if (entry.personal_rating != null) {
      watchedRatings.push([id, Number(entry.personal_rating)]);
    }
    if (entry.watch_date != null) {
      watchedDates.push([id, entry.watch_date]);
    }
    if (entry.notes != null) {
      watchedNotes.push([id, entry.notes]);
    }
    if (entry.rank_position != null) {
      rankedOrder.push(id);
    }
  }

  console.log(`[Journal] Hydrated state: ${watchedIds.length} ids, ${watchedMovies.length} movies, ${watchedRatings.length} ratings`);
  return { watchedIds, watchedMovies, watchedRatings, watchedDates, watchedNotes, rankedOrder, entryIdMap };
}

// ─── One-time migration: localStorage → Supabase ────────────────────────────
// localData: raw localStorage values passed in by the caller.

export async function migrateLocalJournal(userId, localData) {
  if (!supabase) return null;
  try {
    // Skip if user already has journal entries in Supabase
    const { data: existing, error: checkErr } = await supabase
      .from("journal_entries")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (checkErr) throw checkErr;
    if (existing && existing.length > 0) return null;

    const watchedIds = localData.watchedIds || [];
    if (watchedIds.length === 0) return null;

    const movieMap = new Map(localData.watchedMovies || []);
    const ratingMap = new Map(localData.watchedRatings || []);
    const dateMap = new Map(localData.watchedDates || []);
    const noteMap = new Map(localData.watchedNotes || []);

    // Build cache rows for ALL watched IDs — not just those in movieMap.
    // Stale localStorage may have IDs in cc_watchedIds without matching
    // cc_watchedMovies entries. We create placeholder rows so any FK
    // constraint on journal_entries.tmdb_id → movies_cache.tmdb_id is satisfied.
    const now = new Date().toISOString();
    const cacheRows = watchedIds.map((tmdbId) => {
      const m = movieMap.get(tmdbId);
      return {
        tmdb_id: tmdbId,
        title: m?.title || "Unknown",
        poster_path: m?.poster_path || null,
        year: m?.year && m.year !== "\u2014" ? parseInt(m.year) : null,
        rating: m?.rating && m.rating !== "\u2014" ? parseFloat(m.rating) : null,
        synopsis: m?.synopsis || null,
        cached_at: now,
      };
    });
    if (cacheRows.length > 0) {
      const { error } = await supabase
        .from("movies_cache")
        .upsert(cacheRows, { onConflict: "tmdb_id" });
      if (error) console.error("Failed to batch upsert movies_cache during journal migration:", error);
    }

    // Insert journal entries, preserving order as rank_position
    const journalRows = watchedIds.map((tmdbId, i) => ({
      user_id: userId,
      tmdb_id: tmdbId,
      rank_position: i,
      personal_rating: ratingMap.get(tmdbId) ?? null,
      watch_date: dateMap.get(tmdbId) ?? null,
      notes: noteMap.get(tmdbId) ?? null,
    }));

    // Insert in batches of 200 to avoid payload limits
    for (let i = 0; i < journalRows.length; i += 200) {
      const chunk = journalRows.slice(i, i + 200);
      const { error } = await supabase
        .from("journal_entries")
        .insert(chunk);
      if (error) console.error("Failed to migrate journal batch:", error);
    }

    return { migrated: watchedIds.length };
  } catch (e) {
    console.error("Failed to migrate local journal to Supabase:", e);
    return null;
  }
}

// ─── Helpers (private) ───────────────────────────────────────────────────────

// Like upsertMovieCache but ensures the row exists — if the normal upsert fails,
// try a minimal placeholder insert so FK constraints on journal_entries are satisfied.
async function ensureMovieCached(movie) {
  if (!supabase || !movie?.id) return;
  // First attempt: full upsert via watchlistService
  await upsertMovieCache(movie);
  // Verify the row exists (upsertMovieCache swallows errors)
  const { data } = await supabase
    .from("movies_cache")
    .select("tmdb_id")
    .eq("tmdb_id", movie.id)
    .maybeSingle();
  if (data) return; // exists — good
  // Row missing — try a minimal placeholder insert
  console.warn(`[Journal] movies_cache missing for tmdb_id=${movie.id}, inserting placeholder`);
  const { error } = await supabase
    .from("movies_cache")
    .upsert({
      tmdb_id: movie.id,
      title: movie.title || "Unknown",
      poster_path: movie.poster_path || null,
      year: null,
      rating: null,
      synopsis: null,
      cached_at: new Date().toISOString(),
    }, { onConflict: "tmdb_id" });
  if (error) console.error("Failed to insert placeholder movies_cache row:", error);
}

async function fetchMovieCache(tmdbIds) {
  const cacheMap = {};
  if (!tmdbIds.length) return cacheMap;
  for (let i = 0; i < tmdbIds.length; i += 200) {
    const chunk = tmdbIds.slice(i, i + 200);
    try {
      const { data: cached, error } = await supabase
        .from("movies_cache")
        .select("*")
        .in("tmdb_id", chunk);
      if (error) {
        console.error("Failed to load movies_cache chunk:", error);
        continue;
      }
      for (const m of cached || []) cacheMap[m.tmdb_id] = m;
    } catch (e) {
      console.error("movies_cache query threw:", e);
    }
  }
  return cacheMap;
}

function mergeEntryWithCache(entry, cacheMap) {
  const c = cacheMap[entry.tmdb_id];
  return {
    id: entry.tmdb_id,
    entryId: entry.id,
    title: c?.title || "Unknown",
    poster_path: c?.poster_path || null,
    year: c?.year != null ? String(c.year) : "\u2014",
    rating: c?.rating != null ? c.rating.toFixed(1) : "\u2014",
    synopsis: c?.synopsis || "",
    genre: "Film",
    rank_position: entry.rank_position,
    personal_rating: entry.personal_rating != null ? Number(entry.personal_rating) : null,
    watch_date: entry.watch_date,
    notes: entry.notes,
  };
}
