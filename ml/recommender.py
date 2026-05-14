import os
import requests
import random
from datetime import datetime, timezone
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY")
TMDB_BASE = "https://api.themoviedb.org/3"

GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy",
    80: "Crime", 99: "Documentary", 18: "Drama", 10751: "Family",
    14: "Fantasy", 36: "History", 27: "Horror", 10402: "Music",
    9648: "Mystery", 10749: "Romance", 878: "Science Fiction",
    10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western"
}

SWIPE_WEIGHTS = {
    "liked": 2.0,
    "disliked": -2.0,
    "skipped": 1.0
}

JOURNAL_RATING_WEIGHT = 1.5
WATCHLIST_WEIGHT = 1.0
CANDIDATE_PAGES = 5
MAX_RECOMMENDATIONS = 60
SOFT_EXCLUDE_KEEP_PROB = 0.2  # watchlist films appear 20% of the time as reminders


def get_supabase():
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def fetch_all_users(supabase):
    result = supabase.from_("swipe_history").select("user_id").execute()
    user_ids = list({row["user_id"] for row in result.data or []})

    journal_result = supabase.from_("journal_entries").select("user_id").execute()
    for row in journal_result.data or []:
        if row["user_id"] not in user_ids:
            user_ids.append(row["user_id"])

    print(f"[recommender] Found {len(user_ids)} users to process")
    return user_ids


def build_taste_profile(supabase, user_id):
    """Build per-genre taste scores and three exclusion buckets:
      hard_exclude — never recommend (disliked swipes, liked swipes, journal entries)
      soft_exclude — recommend with 20% probability (watchlist saves; user may want a nudge)
      later_ids    — explicitly not excluded (skipped swipes recirculate)
    """
    genre_scores = {}
    hard_exclude = set()
    soft_exclude = set()
    later_ids = set()

    # Signal 1 — swipe history genre scores
    swipes = supabase.from_("swipe_history")\
        .select("action, genre_scores, tmdb_id")\
        .eq("user_id", user_id)\
        .execute()

    for row in swipes.data or []:
        tmdb_id = row["tmdb_id"]
        action = row["action"]
        if action == "liked" or action == "disliked":
            hard_exclude.add(tmdb_id)
        elif action == "skipped":
            later_ids.add(tmdb_id)  # do NOT exclude — let it recirculate
        if row.get("genre_scores") and isinstance(row["genre_scores"], dict):
            weight = SWIPE_WEIGHTS.get(action, 0)
            for genre, score in row["genre_scores"].items():
                genre_scores[genre] = genre_scores.get(genre, 0) + (score * weight)

    # If swipe history yielded no positive signal (all scores <= 0), reset so
    # journal ratings + watchlist become the primary signal instead of being
    # dragged below zero by accumulated dislike weight.
    if genre_scores and all(score <= 0 for score in genre_scores.values()):
        print(f"[recommender] User {user_id[:8]}... swipe scores all <= 0, falling back to journal/watchlist as primary signal")
        genre_scores = {}

    # Signal 2 — journal personal ratings (always hard-excluded: already watched)
    journal = supabase.from_("journal_entries")\
        .select("tmdb_id, personal_rating")\
        .eq("user_id", user_id)\
        .not_.is_("personal_rating", "null")\
        .execute()

    for entry in journal.data or []:
        hard_exclude.add(entry["tmdb_id"])
        if not entry.get("personal_rating"):
            continue
        cache = supabase.from_("movies_cache")\
            .select("genre_ids")\
            .eq("tmdb_id", entry["tmdb_id"])\
            .single()\
            .execute()
        if not cache.data or not cache.data.get("genre_ids"):
            continue
        rating_signal = (float(entry["personal_rating"]) - 5.0) / 5.0
        for genre_id in cache.data["genre_ids"]:
            genre_name = GENRE_MAP.get(genre_id)
            if genre_name:
                genre_scores[genre_name] = genre_scores.get(genre_name, 0) + \
                    (rating_signal * JOURNAL_RATING_WEIGHT)

    # Signal 3 — watchlist saves (implicit positive signal, soft-excluded from recs)
    watchlist = supabase.from_("collection_movies")\
        .select("tmdb_id, collections!inner(user_id, is_default)")\
        .eq("collections.user_id", user_id)\
        .eq("collections.is_default", True)\
        .execute()

    for item in watchlist.data or []:
        soft_exclude.add(item["tmdb_id"])
        cache = supabase.from_("movies_cache")\
            .select("genre_ids")\
            .eq("tmdb_id", item["tmdb_id"])\
            .single()\
            .execute()
        if not cache.data or not cache.data.get("genre_ids"):
            continue
        for genre_id in cache.data["genre_ids"]:
            genre_name = GENRE_MAP.get(genre_id)
            if genre_name:
                genre_scores[genre_name] = genre_scores.get(genre_name, 0) + WATCHLIST_WEIGHT

    print(f"[recommender] User {user_id[:8]}... taste profile: {dict(sorted(genre_scores.items(), key=lambda x: -x[1])[:5])}")
    print(f"[recommender] User {user_id[:8]}... exclusions: hard={len(hard_exclude)} soft={len(soft_exclude)} later={len(later_ids)}")
    return genre_scores, hard_exclude, soft_exclude, later_ids


def fetch_candidate_movies(genre_scores):
    """Three-bucket fetch:
      taste    — top 3 positive-score genres (TMDB discover by genre + popularity)
      adjacent — up to 2 neutral/unexplored genres (vote_average.gte=7.0, vote_count.gte=200)
      wildcard — no genre filter, top-rated quality films from a randomized page
    Returns a dict {"taste": [movies], "adjacent": [movies], "wildcard": [movies]}.
    The same movie can appear in multiple buckets; dedup happens later by source priority.
    """
    genre_name_to_id = {v: k for k, v in GENRE_MAP.items()}

    # ─── BUCKET 1: TASTE — top 3 genres by positive score ──────────────────
    taste = []
    taste_ids = set()
    top_genres = sorted(genre_scores.items(), key=lambda x: -x[1])[:3]
    taste_genre_names = set()
    for genre_name, score in top_genres:
        if score <= 0:
            continue
        genre_id = genre_name_to_id.get(genre_name)
        if not genre_id:
            continue
        taste_genre_names.add(genre_name)
        for page in range(1, CANDIDATE_PAGES + 1):
            url = f"{TMDB_BASE}/discover/movie"
            params = {
                "api_key": TMDB_API_KEY,
                "with_genres": genre_id,
                "sort_by": "popularity.desc",
                "vote_count.gte": 100,
                "page": page,
            }
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code != 200:
                continue
            for m in resp.json().get("results", []):
                if m["id"] not in taste_ids:
                    taste_ids.add(m["id"])
                    taste.append(m)

    # ─── BUCKET 2: ADJACENT — neutral or unexplored genres ─────────────────
    # A genre is "adjacent" if the user has neither strongly disliked it (score > -3)
    # nor strongly liked it (score < 5). Genres with no score at all count as neutral.
    adjacent = []
    adjacent_ids = set()
    adjacent_pool = []
    for genre_name in GENRE_MAP.values():
        if genre_name in taste_genre_names:
            continue
        score = genre_scores.get(genre_name, 0)
        if -3 < score < 5:
            adjacent_pool.append(genre_name)

    if adjacent_pool:
        picks = random.sample(adjacent_pool, min(2, len(adjacent_pool)))
        for genre_name in picks:
            genre_id = genre_name_to_id.get(genre_name)
            if not genre_id:
                continue
            for page in range(1, 3):  # 2 pages per adjacent genre
                url = f"{TMDB_BASE}/discover/movie"
                params = {
                    "api_key": TMDB_API_KEY,
                    "with_genres": genre_id,
                    "sort_by": "popularity.desc",
                    "vote_average.gte": 7.0,
                    "vote_count.gte": 200,
                    "page": page,
                }
                resp = requests.get(url, params=params, timeout=10)
                if resp.status_code != 200:
                    continue
                for m in resp.json().get("results", []):
                    if m["id"] not in adjacent_ids:
                        adjacent_ids.add(m["id"])
                        adjacent.append(m)

    # ─── BUCKET 3: WILDCARD — top-rated, no genre filter ───────────────────
    # Exclude films whose primary genre is in the strongly-disliked set (score < -5).
    strongly_disliked_ids = {
        genre_name_to_id[name]
        for name, score in genre_scores.items()
        if score < -5 and name in genre_name_to_id
    }
    wildcard = []
    wildcard_ids = set()
    wildcard_page = random.randint(1, 10)
    for page in (wildcard_page, wildcard_page + 1):
        url = f"{TMDB_BASE}/discover/movie"
        params = {
            "api_key": TMDB_API_KEY,
            "sort_by": "vote_average.desc",
            "vote_average.gte": 7.5,
            "vote_count.gte": 500,
            "page": page,
        }
        resp = requests.get(url, params=params, timeout=10)
        if resp.status_code != 200:
            continue
        for m in resp.json().get("results", []):
            if m["id"] in wildcard_ids:
                continue
            primary_genre = (m.get("genre_ids") or [None])[0]
            if primary_genre in strongly_disliked_ids:
                continue
            wildcard_ids.add(m["id"])
            wildcard.append(m)

    print(f"[recommender] Buckets — taste={len(taste)} adjacent={len(adjacent)} wildcard={len(wildcard)}")
    return {"taste": taste, "adjacent": adjacent, "wildcard": wildcard}


def score_movie(movie, genre_scores, source="taste"):
    score = 0.0
    genre_ids = movie.get("genre_ids", [])

    # Genre match score
    for genre_id in genre_ids:
        genre_name = GENRE_MAP.get(genre_id)
        if genre_name and genre_name in genre_scores:
            score += genre_scores[genre_name]

    # TMDB popularity bonus (small weight to break ties)
    popularity = movie.get("popularity", 0)
    score += min(popularity / 1000, 1.0)

    # TMDB rating bonus
    vote_avg = movie.get("vote_average", 0)
    score += (vote_avg / 10) * 0.5

    # Discovery bonus — ensures off-taste recs aren't always outscored
    if source == "adjacent":
        score += 0.5
    elif source == "wildcard":
        score += 1.0

    return score


def build_reason(source, top_genre):
    if source == "taste":
        return f"Matches your taste in {top_genre}" if top_genre else "Matches your taste"
    if source == "adjacent":
        return f"Something different — {top_genre} you haven't explored yet" if top_genre else "Something different"
    # wildcard
    return "Something completely new — highly rated"


def write_recommendations(supabase, user_id, scored_movies):
    # Delete old recommendations for this user
    supabase.from_("recommendations")\
        .delete()\
        .eq("user_id", user_id)\
        .execute()

    # Insert new recommendations
    rows = []
    for movie, score, source in scored_movies[:MAX_RECOMMENDATIONS]:
        genre_ids = movie.get("genre_ids", [])
        top_genre = GENRE_MAP.get(genre_ids[0]) if genre_ids else None
        rows.append({
            "user_id": user_id,
            "tmdb_id": movie["id"],
            "title": movie.get("title"),
            "poster_path": movie.get("poster_path"),
            "backdrop_path": movie.get("backdrop_path"),
            "genre_ids": genre_ids,
            "release_date": movie.get("release_date"),
            "vote_average": movie.get("vote_average"),
            "overview": movie.get("overview"),
            "score": round(score, 4),
            "reason": build_reason(source, top_genre),
            "source": source,
            "generated_at": datetime.now(timezone.utc).isoformat()
        })

    if rows:
        supabase.from_("recommendations").insert(rows).execute()
        source_counts = {}
        for r in rows:
            source_counts[r["source"]] = source_counts.get(r["source"], 0) + 1
        print(f"[recommender] Wrote {len(rows)} recommendations for user {user_id[:8]}... ({source_counts})")


def process_user(supabase, user_id):
    try:
        genre_scores, hard_exclude, soft_exclude, later_ids = build_taste_profile(supabase, user_id)
        buckets = fetch_candidate_movies(genre_scores)

        # Walk buckets in priority order so a movie appearing in multiple buckets
        # keeps the higher-priority source (taste > adjacent > wildcard).
        scored_by_id = {}
        for source in ("taste", "adjacent", "wildcard"):
            for m in buckets.get(source, []):
                tmdb_id = m["id"]
                if tmdb_id in scored_by_id:
                    continue
                if tmdb_id in hard_exclude:
                    continue
                if tmdb_id in soft_exclude and random.random() >= SOFT_EXCLUDE_KEEP_PROB:
                    continue
                score = score_movie(m, genre_scores, source=source)
                scored_by_id[tmdb_id] = (m, score, source)

        # Enforce hard bucket caps so adjacent + wildcard always contribute
        # meaningful diversity even when taste scores dominate.
        by_source = {"taste": [], "adjacent": [], "wildcard": []}
        for entry in scored_by_id.values():
            by_source[entry[2]].append(entry)
        for source in by_source:
            by_source[source].sort(key=lambda x: -x[1])

        taste_capped = by_source["taste"][:36]
        adjacent_capped = by_source["adjacent"][:12]
        wildcard_capped = by_source["wildcard"][:12]

        deficit = (12 - len(adjacent_capped)) + (12 - len(wildcard_capped))
        if deficit > 0:
            taste_overflow = by_source["taste"][36:36 + deficit]
            taste_capped = taste_capped + taste_overflow

        scored = sorted(
            taste_capped + adjacent_capped + wildcard_capped,
            key=lambda x: -x[1],
        )
        write_recommendations(supabase, user_id, scored)
    except Exception as e:
        print(f"[recommender] ERROR processing user {user_id[:8]}...: {e}")


def main():
    print(f"[recommender] Starting at {datetime.now(timezone.utc).isoformat()}")
    supabase = get_supabase()
    user_ids = fetch_all_users(supabase)
    for user_id in user_ids:
        process_user(supabase, user_id)
    print(f"[recommender] Done at {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    main()
