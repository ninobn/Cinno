import { supabase } from '../supabase.js';

// ─── Profile ─────────────────────────────────────────────────────────────────

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

export async function upsertProfile(userId, updates) {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, ...updates, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function searchUsers(query, currentUserId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, display_name, avatar_url, is_private')
    .ilike('username', `%${query}%`)
    .neq('id', currentUserId)
    .limit(20);
  if (error) throw error;
  return data || [];
}

export async function updatePinnedFilms(userId, tmdbIds) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ pinned_film_ids: tmdbIds, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// ─── Unified Friends-tab search ────────────────────────────────────────────

// Score a single field against the query: exact = 3, prefix = 2, contains = 1, none = 0.
function scoreMatch(value, query) {
  if (!value) return 0;
  const v = String(value).toLowerCase();
  const q = query.toLowerCase();
  if (v === q) return 3;
  if (v.startsWith(q)) return 2;
  if (v.includes(q)) return 1;
  return 0;
}

// Pure ranking helper — sorts items by how well `field` matches `query`
// (exact > prefix > contains). Exported so it can be tested or reused, and so
// the scoring can later be upgraded to weighted ranking in one place.
export function rankResults(items, query, field) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [...(items || [])];
  return [...(items || [])]
    .map((item) => ({ item, score: scoreMatch(item?.[field], q) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

// Unified search across People → Lists → Films for the Friends tab.
// Films are only returned when there is no strong People/Lists match
// (strong = at least one exact or prefix hit). Each category fails soft:
// a query error yields an empty section rather than throwing.
export async function searchFriendsTab(query, currentUserId, options = {}) {
  const q = (query || '').trim();
  const out = { people: [], lists: [], films: [] };
  if (q.length < 2) return out;

  const peopleLimit = options.limit || 10;
  const listsLimit = options.limit || 10;
  const filmsLimit = options.limit || 5;
  const like = `%${q}%`;

  // People — match username OR display_name, ranked by username relevance
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, username, display_name, avatar_url, is_private')
      .or(`username.ilike.${like},display_name.ilike.${like}`)
      .neq('id', currentUserId)
      .limit(peopleLimit);
    if (error) throw error;
    let people = rankResults(data || [], q, 'username');
    const ids = people.map((p) => p.id);
    if (ids.length > 0) {
      const { data: followRows } = await supabase
        .from('follows')
        .select('following_id')
        .in('following_id', ids)
        .eq('status', 'accepted');
      const counts = {};
      (followRows || []).forEach((r) => { counts[r.following_id] = (counts[r.following_id] || 0) + 1; });
      people = people.map((p) => ({ ...p, followerCount: counts[p.id] || 0 }));
    }
    out.people = people;
  } catch (e) {
    out.people = [];
  }

  // Lists — public lists by name, with creator profile + film count
  try {
    const { data, error } = await supabase
      .from('lists')
      .select('*, list_films(count)')
      .ilike('name', like)
      .eq('is_public', true)
      .limit(listsLimit);
    if (error) throw error;
    const lists = rankResults(data || [], q, 'name');
    const creatorIds = [...new Set(lists.map((l) => l.user_id).filter(Boolean))];
    const profileMap = {};
    if (creatorIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, username, display_name, avatar_url')
        .in('id', creatorIds);
      (profiles || []).forEach((p) => { profileMap[p.id] = p; });
    }
    out.lists = lists.map((l) => ({
      ...l,
      creator: profileMap[l.user_id] || null,
      filmCount: l.list_films?.[0]?.count || 0,
    }));
  } catch (e) {
    out.lists = [];
  }

  // Films — only when neither People nor Lists has a strong (exact/prefix) match
  const peopleStrong = out.people.some((p) => scoreMatch(p.username, q) >= 2 || scoreMatch(p.display_name, q) >= 2);
  const listsStrong = out.lists.some((l) => scoreMatch(l.name, q) >= 2);
  if (!peopleStrong && !listsStrong) {
    try {
      const { data, error } = await supabase
        .from('movies_cache')
        .select('tmdb_id, title, poster_path, year, genre_ids')
        .ilike('title', like)
        .limit(filmsLimit);
      if (error) throw error;
      out.films = rankResults(data || [], q, 'title');
    } catch (e) {
      out.films = [];
    }
  }

  return out;
}

// ─── Follow ──────────────────────────────────────────────────────────────────

export async function followUser(followerId, followingId) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_private')
    .eq('id', followingId)
    .single();

  const status = profile?.is_private ? 'pending' : 'accepted';

  const { error } = await supabase
    .from('follows')
    .upsert({ follower_id: followerId, following_id: followingId, status })
    .select();
  if (error) throw error;
  return status;
}

export async function unfollowUser(followerId, followingId) {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
  if (error) throw error;
}

export async function acceptFollowRequest(followerId, followingId) {
  const { error } = await supabase
    .from('follows')
    .update({ status: 'accepted' })
    .eq('follower_id', followerId)
    .eq('following_id', followingId);
  if (error) throw error;
}

export async function getFollowStatus(followerId, followingId) {
  const { data, error } = await supabase
    .from('follows')
    .select('status')
    .eq('follower_id', followerId)
    .eq('following_id', followingId)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data?.status || null;
}

export async function getFollowing(userId) {
  const { data, error } = await supabase
    .from('follows')
    .select(`
      following_id,
      status,
      user_profiles!follows_following_id_fkey (
        id, username, display_name, avatar_url, is_private
      )
    `)
    .eq('follower_id', userId)
    .eq('status', 'accepted');
  if (error) throw error;
  return (data || []).map(row => ({
    ...row.user_profiles,
    followStatus: row.status,
  }));
}

export async function getFollowers(userId) {
  const { data, error } = await supabase
    .from('follows')
    .select(`
      follower_id,
      status,
      user_profiles!follows_follower_id_fkey (
        id, username, display_name, avatar_url, is_private
      )
    `)
    .eq('following_id', userId);
  if (error) throw error;
  return (data || []).map(row => ({
    ...row.user_profiles,
    followStatus: row.status,
  }));
}

export async function getPendingRequests(userId) {
  const { data, error } = await supabase
    .from('follows')
    .select(`
      follower_id,
      created_at,
      user_profiles!follows_follower_id_fkey (
        id, username, display_name, avatar_url
      )
    `)
    .eq('following_id', userId)
    .eq('status', 'pending');
  if (error) throw error;
  return (data || []).map(row => ({
    ...row.user_profiles,
    requestedAt: row.created_at,
  }));
}

// ─── Activity ────────────────────────────────────────────────────────────────

export async function recordActivity(userId, actionType, tmdbId, options = {}) {
  const { rating = null, note = null } = options;
  const { error } = await supabase
    .from('activity')
    .upsert({
      user_id: userId,
      action_type: actionType,
      tmdb_id: tmdbId,
      rating,
      note,
      created_at: new Date().toISOString(),
    }, { onConflict: 'user_id,tmdb_id,action_type', ignoreDuplicates: false });
  if (error) throw error;
}

export async function getActivityFeed(userId, limit = 20) {
  const { data: followData, error: followError } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');
  if (followError) throw followError;

  const followingIds = (followData || []).map(f => f.following_id);
  if (followingIds.length === 0) return [];

  const { data, error } = await supabase
    .from('activity')
    .select(`
      *,
      user_profiles!activity_user_id_fkey (
        id, username, display_name, avatar_url
      )
    `)
    .in('user_id', followingIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data || [];
  const tmdbIds = [...new Set(rows.map(a => a.tmdb_id))];
  const { data: movies } = await supabase
    .from('movies_cache')
    .select('tmdb_id, title, poster_path, year, rating, genre_ids')
    .in('tmdb_id', tmdbIds);

  const movieMap = {};
  (movies || []).forEach(m => { movieMap[m.tmdb_id] = m; });

  // Rating source: journal_entries.personal_rating — same as Journal.
  // activity.rating is a frozen snapshot from log time and drifts when the
  // user re-rates. Batch-fetch the live rating for every (user_id, tmdb_id)
  // pair seen in the feed and overwrite activity.rating with it so the feed
  // always shows what the Journal shows.
  const ratedRows = rows.filter((r) => r.action_type === 'rated');
  const ratedUserIds = [...new Set(ratedRows.map((r) => r.user_id))];
  const ratedTmdbIds = [...new Set(ratedRows.map((r) => r.tmdb_id))];
  const ratingMap = new Map(); // key: `${user_id}|${tmdb_id}` → personal_rating
  if (ratedUserIds.length > 0 && ratedTmdbIds.length > 0) {
    const { data: journalRows } = await supabase
      .from('journal_entries')
      .select('user_id, tmdb_id, personal_rating')
      .in('user_id', ratedUserIds)
      .in('tmdb_id', ratedTmdbIds);
    (journalRows || []).forEach((j) => {
      ratingMap.set(
        `${j.user_id}|${j.tmdb_id}`,
        j.personal_rating != null ? Number(j.personal_rating) : null,
      );
    });
  }

  return rows.map(item => {
    const liveRating = item.action_type === 'rated'
      ? ratingMap.get(`${item.user_id}|${item.tmdb_id}`)
      : undefined;
    return {
      ...item,
      // Only overwrite when we successfully resolved a journal entry; otherwise
      // keep the activity-table snapshot so older "rated" rows still render.
      rating: liveRating !== undefined ? liveRating : item.rating,
      user: item.user_profiles,
      movie: movieMap[item.tmdb_id] || null,
    };
  });
}

export async function getOwnActivity(userId, limit = 30) {
  const { data, error } = await supabase
    .from('activity')
    .select('*')
    .eq('user_id', userId)
    .eq('action_type', 'logged')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const tmdbIds = [...new Set((data || []).map(a => a.tmdb_id))];
  const { data: movies } = await supabase
    .from('movies_cache')
    .select('tmdb_id, title, poster_path, year, rating, genre_ids')
    .in('tmdb_id', tmdbIds);

  const movieMap = {};
  (movies || []).forEach(m => { movieMap[m.tmdb_id] = m; });

  return (data || []).map(item => ({
    ...item,
    movie: movieMap[item.tmdb_id] || null,
  }));
}

// Own "expressive" activity for the Profile center feed: ratings and written
// notes/reviews only (the intentional posts) — never raw logged/watchlisted rows
// unless they carry a note. Joined with movies_cache, newest first.
export async function getOwnExpressiveActivity(userId, limit = 20) {
  const { data, error } = await supabase
    .from('activity')
    .select('*')
    .eq('user_id', userId)
    .or('action_type.eq.rated,action_type.eq.noted,note.not.is.null')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = (data || []).filter(
    (item) => item.action_type === 'rated' || item.action_type === 'noted' || (item.note && item.note.trim())
  );

  const tmdbIds = [...new Set(rows.map((a) => a.tmdb_id))];
  const { data: movies } = await supabase
    .from('movies_cache')
    .select('tmdb_id, title, poster_path, year, rating, genre_ids')
    .in('tmdb_id', tmdbIds);

  const movieMap = {};
  (movies || []).forEach((m) => { movieMap[m.tmdb_id] = m; });

  // Rating source: journal_entries.personal_rating — same as Journal.
  // The `activity` table keeps its own `rating` copy that can drift from the
  // journal (e.g. a "logged" row freezes the rating at log time, while
  // re-rating updates journal_entries.personal_rating). The Profile post must
  // show the *exact* value the Journal shows, so we read personal_rating
  // straight from journal_entries and ignore activity.rating entirely.
  // Same source, same field, same value always.
  const { data: journalRows } = await supabase
    .from('journal_entries')
    .select('tmdb_id, personal_rating')
    .eq('user_id', userId)
    .in('tmdb_id', tmdbIds);

  const journalRatingMap = {};
  (journalRows || []).forEach((j) => {
    journalRatingMap[j.tmdb_id] = j.personal_rating != null ? Number(j.personal_rating) : null;
  });

  return rows.map((item) => ({
    ...item,
    rating: journalRatingMap[item.tmdb_id] ?? null,
    movie: movieMap[item.tmdb_id] || null,
  }));
}

export async function getTrendingInCircle(userId, limit = 3) {
  const { data: followData } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', userId)
    .eq('status', 'accepted');

  const followingIds = (followData || []).map(f => f.following_id);
  if (followingIds.length === 0) return [];

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('activity')
    .select('tmdb_id, user_id')
    .in('user_id', followingIds)
    .gte('created_at', weekAgo);
  if (error) throw error;

  const counts = {};
  const usersByFilm = {};
  (data || []).forEach(item => {
    counts[item.tmdb_id] = (counts[item.tmdb_id] || 0) + 1;
    if (!usersByFilm[item.tmdb_id]) usersByFilm[item.tmdb_id] = new Set();
    usersByFilm[item.tmdb_id].add(item.user_id);
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tmdbId]) => parseInt(tmdbId));

  if (sorted.length === 0) return [];

  const { data: movies } = await supabase
    .from('movies_cache')
    .select('tmdb_id, title, poster_path, year, genre_ids')
    .in('tmdb_id', sorted);

  const movieMap = {};
  (movies || []).forEach(m => { movieMap[m.tmdb_id] = m; });

  return sorted.map(tmdbId => ({
    movie: movieMap[tmdbId] || null,
    friendCount: usersByFilm[tmdbId]?.size || 0,
  })).filter(item => item.movie);
}

// ─── Reactions ───────────────────────────────────────────────────────────────

export async function toggleReaction(userId, activityId) {
  const { data: existing } = await supabase
    .from('reactions')
    .select('id')
    .eq('user_id', userId)
    .eq('activity_id', activityId)
    .single();

  if (existing) {
    await supabase.from('reactions').delete().eq('id', existing.id);
    return false;
  } else {
    await supabase.from('reactions').insert({ user_id: userId, activity_id: activityId });
    return true;
  }
}

export async function getReactionCount(activityId) {
  const { count, error } = await supabase
    .from('reactions')
    .select('*', { count: 'exact', head: true })
    .eq('activity_id', activityId);
  if (error) throw error;
  return count || 0;
}

export async function getReactionCounts(activityIds) {
  if (!activityIds || activityIds.length === 0) return {};
  const { data, error } = await supabase
    .from('reactions')
    .select('activity_id')
    .in('activity_id', activityIds);
  if (error) throw error;
  const counts = {};
  (data || []).forEach((row) => {
    counts[row.activity_id] = (counts[row.activity_id] || 0) + 1;
  });
  return counts;
}

export async function getUserReactions(userId, activityIds) {
  if (!activityIds || activityIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('reactions')
    .select('activity_id')
    .eq('user_id', userId)
    .in('activity_id', activityIds);
  if (error) throw error;
  return new Set((data || []).map((r) => r.activity_id));
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function getComments(activityId) {
  const { data, error } = await supabase
    .from('comments')
    .select('*, user_profiles(id, username, display_name, avatar_url)')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(c => ({ ...c, user: c.user_profiles }));
}

export async function postComment(userId, activityId, content) {
  const { data, error } = await supabase
    .from('comments')
    .insert({ user_id: userId, activity_id: activityId, content })
    .select('*, user_profiles(id, username, display_name, avatar_url)')
    .single();
  if (error) throw error;
  return { ...data, user: data.user_profiles };
}

export async function getCommentCounts(activityIds) {
  if (!activityIds || activityIds.length === 0) return {};
  const { data, error } = await supabase
    .from('comments')
    .select('activity_id')
    .in('activity_id', activityIds);
  if (error) throw error;
  const counts = {};
  (data || []).forEach(row => {
    counts[row.activity_id] = (counts[row.activity_id] || 0) + 1;
  });
  return counts;
}
