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

  const tmdbIds = [...new Set((data || []).map(a => a.tmdb_id))];
  const { data: movies } = await supabase
    .from('movies_cache')
    .select('tmdb_id, title, poster_path, year, rating, genre_ids')
    .in('tmdb_id', tmdbIds);

  const movieMap = {};
  (movies || []).forEach(m => { movieMap[m.tmdb_id] = m; });

  return (data || []).map(item => ({
    ...item,
    user: item.user_profiles,
    movie: movieMap[item.tmdb_id] || null,
  }));
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
