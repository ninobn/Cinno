import { supabase } from "../supabase.js";

// ─── Column mapping ──────────────────────────────────────────────────────────
//
// Supabase table: user_preferences
// Columns: id, user_id (unique), theme_settings (jsonb), ui_toggles (jsonb),
//          genre_preferences (jsonb), updated_at (timestamptz)
//
// theme_settings:    { theme }
// ui_toggles:        { smartMode, badgeShowcase, rankSort, journalSort }
// genre_preferences: { tasteProfile, discoverMaybeLater }
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  theme_settings: { theme: "dark" },
  ui_toggles: { smartMode: false, badgeShowcase: [], rankSort: "rating_desc", journalSort: "date_desc" },
  genre_preferences: { tasteProfile: "", discoverMaybeLater: [] },
};

// ─── Read ────────────────────────────────────────────────────────────────────

export async function getPreferences(userId) {
  if (!supabase) return { ...DEFAULTS };
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("theme_settings, ui_toggles, genre_preferences")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ...DEFAULTS };
    return {
      theme_settings: { ...DEFAULTS.theme_settings, ...data.theme_settings },
      ui_toggles: { ...DEFAULTS.ui_toggles, ...data.ui_toggles },
      genre_preferences: { ...DEFAULTS.genre_preferences, ...data.genre_preferences },
    };
  } catch (e) {
    console.error("Failed to load preferences from Supabase:", e);
    return { ...DEFAULTS };
  }
}

// ─── Full upsert ─────────────────────────────────────────────────────────────

export async function savePreferences(userId, preferences) {
  if (!supabase) return false;
  try {
    const row = {
      user_id: userId,
      theme_settings: preferences.theme_settings ?? DEFAULTS.theme_settings,
      ui_toggles: preferences.ui_toggles ?? DEFAULTS.ui_toggles,
      genre_preferences: preferences.genre_preferences ?? DEFAULTS.genre_preferences,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("user_preferences")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error("Failed to save preferences to Supabase:", e);
    return false;
  }
}

// ─── Partial column updates ──────────────────────────────────────────────────

async function updateColumn(userId, column, partial) {
  if (!supabase) return false;
  try {
    // Read existing value so we can merge instead of overwrite
    const { data: existing } = await supabase
      .from("user_preferences")
      .select(column)
      .eq("user_id", userId)
      .maybeSingle();
    const merged = { ...(DEFAULTS[column] || {}), ...(existing?.[column] || {}), ...partial };
    const row = {
      user_id: userId,
      [column]: merged,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("user_preferences")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error(`Failed to update ${column} in Supabase:`, e);
    return false;
  }
}

export function updateThemeSettings(userId, themeSettings) {
  return updateColumn(userId, "theme_settings", themeSettings);
}

export function updateUIToggles(userId, uiToggles) {
  return updateColumn(userId, "ui_toggles", uiToggles);
}

export function updateGenrePreferences(userId, genrePreferences) {
  return updateColumn(userId, "genre_preferences", genrePreferences);
}

// ─── One-time migration: localStorage → Supabase ────────────────────────────
// Reads preference keys from localStorage (using the caller-provided reader),
// checks if the user already has a row in Supabase, and if not, writes it.
// Returns the merged preferences object on success, or null if skipped/failed.

export async function migrateLocalPreferences(userId, localPrefs) {
  if (!supabase) return null;
  try {
    // If user already has preferences in Supabase, skip migration
    const { data: existing } = await supabase
      .from("user_preferences")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) return null;

    const merged = {
      theme_settings: { ...DEFAULTS.theme_settings, ...localPrefs.theme_settings },
      ui_toggles: { ...DEFAULTS.ui_toggles, ...localPrefs.ui_toggles },
      genre_preferences: { ...DEFAULTS.genre_preferences, ...localPrefs.genre_preferences },
    };
    const ok = await savePreferences(userId, merged);
    return ok ? merged : null;
  } catch (e) {
    console.error("Failed to migrate local preferences to Supabase:", e);
    return null;
  }
}
