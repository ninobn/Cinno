import { supabase } from '../supabase.js';
import { searchMovies } from '../tmdb.js';

// ─── Lists CRUD ──────────────────────────────────────────────────────────────

export async function getOwnLists(userId) {
  const { data: lists, error } = await supabase
    .from('lists')
    .select('*, list_films(count)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  if (!lists || lists.length === 0) return [];

  // Fetch preview posters (up to 4 per list) in a single batched query.
  // Postgrest can't natively LIMIT 4 PER GROUP — fetch all rows for these lists
  // ordered by (list_id, sort_order), then group + slice in JS.
  const listIds = lists.map((l) => l.id);
  const { data: filmRows, error: filmsError } = await supabase
    .from('list_films')
    .select('list_id, sort_order, movies_cache(poster_path)')
    .in('list_id', listIds)
    .order('list_id', { ascending: true })
    .order('sort_order', { ascending: true });
  if (filmsError) throw filmsError;

  const postersByList = {};
  (filmRows || []).forEach((row) => {
    const lid = row.list_id;
    if (!postersByList[lid]) postersByList[lid] = [];
    if (postersByList[lid].length >= 4) return;
    const p = row.movies_cache?.poster_path;
    if (p) postersByList[lid].push(p);
  });

  return lists.map((l) => ({ ...l, previewPosters: postersByList[l.id] || [] }));
}

export async function getPublicLists(userId) {
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_films(count)')
    .eq('user_id', userId)
    .eq('is_public', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getList(listId) {
  const { data: list, error } = await supabase
    .from('lists')
    .select('*')
    .eq('id', listId)
    .single();
  if (error) throw error;

  const { data: films, error: filmsError } = await supabase
    .from('list_films')
    .select('*, movies_cache(tmdb_id, title, poster_path, year, rating, genre_ids)')
    .eq('list_id', listId)
    .order('sort_order', { ascending: true });
  if (filmsError) throw filmsError;

  return {
    ...list,
    films: (films || []).map((f) => ({
      ...f.movies_cache,
      listFilmId: f.id,
      sortOrder: f.sort_order,
      addedAt: f.added_at,
    })),
  };
}

export async function createList(userId, { name, description = null, is_public = true }) {
  const { data, error } = await supabase
    .from('lists')
    .insert({
      user_id: userId,
      name,
      description,
      is_public,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateList(listId, updates) {
  const { data, error } = await supabase
    .from('lists')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', listId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteList(listId) {
  const { error } = await supabase
    .from('lists')
    .delete()
    .eq('id', listId);
  if (error) throw error;
}

export async function uploadListCover(listId, file) {
  const ext = file.name.split('.').pop();
  const path = `list-covers/${listId}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from('list-covers')
    .upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage
    .from('list-covers')
    .getPublicUrl(path);

  await updateList(listId, { cover_image_url: data.publicUrl });
  return data.publicUrl;
}

// ─── List films ──────────────────────────────────────────────────────────────

export async function addFilmToList(listId, movie) {
  const { error: cacheError } = await supabase
    .from('movies_cache')
    .upsert({
      tmdb_id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      year: movie.year ? parseInt(movie.year) : null,
      rating: movie.rating ? parseFloat(movie.rating) : null,
      synopsis: movie.synopsis || null,
      genre_ids: movie.genre_ids || [],
    }, { onConflict: 'tmdb_id' });
  if (cacheError) throw cacheError;

  const { data: existing } = await supabase
    .from('list_films')
    .select('sort_order')
    .eq('list_id', listId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextOrder = existing?.[0]?.sort_order != null
    ? existing[0].sort_order + 1
    : 0;

  const { error } = await supabase
    .from('list_films')
    .upsert({
      list_id: listId,
      tmdb_id: movie.id,
      sort_order: nextOrder,
      added_at: new Date().toISOString(),
    }, { onConflict: 'list_id,tmdb_id' });
  if (error) throw error;

  await supabase
    .from('lists')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', listId);
}

export async function removeFilmFromList(listId, tmdbId) {
  const { error } = await supabase
    .from('list_films')
    .delete()
    .eq('list_id', listId)
    .eq('tmdb_id', tmdbId);
  if (error) throw error;
}

export async function reorderListFilms(listId, orderedTmdbIds) {
  const updates = orderedTmdbIds.map((tmdbId, index) => ({
    list_id: listId,
    tmdb_id: tmdbId,
    sort_order: index,
  }));

  const { error } = await supabase
    .from('list_films')
    .upsert(updates, { onConflict: 'list_id,tmdb_id' });
  if (error) throw error;
}

export async function addMultipleFilmsToList(listId, movies) {
  for (const movie of movies) {
    await addFilmToList(listId, movie);
  }
}

// ─── Saves (saving other users' lists) ───────────────────────────────────────

export async function saveList(userId, listId) {
  const { error } = await supabase
    .from('list_saves')
    .upsert({ user_id: userId, list_id: listId, saved_at: new Date().toISOString() });
  if (error) throw error;
}

export async function unsaveList(userId, listId) {
  const { error } = await supabase
    .from('list_saves')
    .delete()
    .eq('user_id', userId)
    .eq('list_id', listId);
  if (error) throw error;
}

export async function isListSaved(userId, listId) {
  const { data } = await supabase
    .from('list_saves')
    .select('id')
    .eq('user_id', userId)
    .eq('list_id', listId)
    .maybeSingle();
  return !!data;
}

export async function getSavedLists(userId) {
  const { data, error } = await supabase
    .from('list_saves')
    .select('saved_at, lists(*, list_films(count))')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });
  if (error) throw error;

  const lists = (data || []).map((row) => row.lists).filter(Boolean);
  if (lists.length === 0) return [];

  const listIds = lists.map((l) => l.id);
  const creatorIds = [...new Set(lists.map((l) => l.user_id).filter(Boolean))];

  // Batch preview posters (up to 4 per list) and creator profiles in parallel.
  const [filmsRes, profilesRes] = await Promise.all([
    supabase
      .from('list_films')
      .select('list_id, sort_order, movies_cache(poster_path)')
      .in('list_id', listIds)
      .order('list_id', { ascending: true })
      .order('sort_order', { ascending: true }),
    creatorIds.length > 0
      ? supabase.from('user_profiles').select('id, username, display_name, avatar_url').in('id', creatorIds)
      : Promise.resolve({ data: [] }),
  ]);

  const postersByList = {};
  (filmsRes.data || []).forEach((row) => {
    const lid = row.list_id;
    if (!postersByList[lid]) postersByList[lid] = [];
    if (postersByList[lid].length >= 4) return;
    const p = row.movies_cache?.poster_path;
    if (p) postersByList[lid].push(p);
  });

  const profileMap = {};
  (profilesRes.data || []).forEach((p) => { profileMap[p.id] = p; });

  return lists.map((l) => ({
    ...l,
    creator: profileMap[l.user_id] || null,
    previewPosters: postersByList[l.id] || [],
  }));
}

// ─── Search (TMDB for adding films) ──────────────────────────────────────────

export async function searchFilmsForList(query) {
  if (!query || query.trim().length < 2) return [];
  const { movies } = await searchMovies(query);
  return (movies || []).slice(0, 10);
}
