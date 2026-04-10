import { supabase } from "../supabase.js";

// ─── Supabase table ─────────────────────────────────────────────────────────
//
// swipe_history  (id uuid PK, user_id uuid FK, tmdb_id int, action text,
//                 genre_scores jsonb, swiped_at timestamptz)
//   Unique constraint on (user_id, tmdb_id).
//   action enum: 'liked', 'disliked', 'skipped'
// ─────────────────────────────────────────────────────────────────────────────

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getSwipeHistory(userId) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("swipe_history")
    .select("tmdb_id, action, genre_scores, swiped_at")
    .eq("user_id", userId);
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) {
    map.set(row.tmdb_id, {
      action: row.action,
      genre_scores: row.genre_scores,
      swiped_at: row.swiped_at,
    });
  }
  return map;
}

export async function getSkippedMovieIds(userId) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("swipe_history")
    .select("tmdb_id")
    .eq("user_id", userId)
    .eq("action", "skipped");
  if (error) throw error;
  return new Set((data || []).map((r) => r.tmdb_id));
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function recordSwipe(userId, tmdbId, action, genreScores = null) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("swipe_history")
    .upsert({
      user_id: userId,
      tmdb_id: tmdbId,
      action,
      genre_scores: genreScores,
      swiped_at: new Date().toISOString(),
    }, { onConflict: "user_id, tmdb_id" });
  if (error) throw error;
}

export async function clearSwipeHistory(userId) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("swipe_history")
    .delete()
    .eq("user_id", userId);
  if (error) throw error;
}

// ─── Bulk load: hydrate full React state ─────────────────────────────────────
// Returns { seenIds, genreScores, maybeLaterIds }

export async function loadFullDiscoverState(userId) {
  if (!supabase) throw new Error("No Supabase client");

  const { data: rows, error } = await supabase
    .from("swipe_history")
    .select("tmdb_id, action, genre_scores")
    .eq("user_id", userId);
  if (error) throw error;

  const seenIds = new Set();
  const maybeLaterIds = new Set();
  const genreScores = {};

  for (const row of rows || []) {
    seenIds.add(row.tmdb_id);
    if (row.action === "skipped") {
      maybeLaterIds.add(row.tmdb_id);
    }
    // Merge genre_scores additively — each swipe's scores accumulate
    if (row.genre_scores && typeof row.genre_scores === "object") {
      for (const [genre, score] of Object.entries(row.genre_scores)) {
        genreScores[genre] = (genreScores[genre] || 0) + score;
      }
    }
  }

  return { seenIds, genreScores, maybeLaterIds };
}

// ─── One-time migration: localStorage → Supabase ────────────────────────────

export async function migrateLocalDiscover(userId, localData) {
  if (!supabase) return null;
  try {
    // Skip if user already has swipe data in Supabase
    const { data: existing, error: checkErr } = await supabase
      .from("swipe_history")
      .select("id")
      .eq("user_id", userId)
      .limit(1);
    if (checkErr) throw checkErr;
    if (existing && existing.length > 0) return null;

    const rows = [];
    const now = new Date().toISOString();

    // Migrate maybeLater as 'skipped' entries
    const maybeLater = localData.maybeLater || [];
    for (const movie of maybeLater) {
      if (!movie?.id) continue;
      rows.push({
        user_id: userId,
        tmdb_id: movie.id,
        action: "skipped",
        genre_scores: null,
        swiped_at: movie.addedAt ? new Date(movie.addedAt).toISOString() : now,
      });
    }

    if (rows.length === 0) return null;

    // Insert in batches of 200
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await supabase
        .from("swipe_history")
        .upsert(chunk, { onConflict: "user_id, tmdb_id" });
      if (error) console.error("Failed to migrate discover batch:", error);
    }

    return { migrated: rows.length };
  } catch (e) {
    console.error("Failed to migrate local discover to Supabase:", e);
    return null;
  }
}
