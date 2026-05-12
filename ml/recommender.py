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
    "skipped": 0.0
}

JOURNAL_RATING_WEIGHT = 1.5
WATCHLIST_WEIGHT = 1.0
CANDIDATE_PAGES = 5
MAX_RECOMMENDATIONS = 50


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
    genre_scores = {}

    # Signal 1 — swipe history genre scores
    swipes = supabase.from_("swipe_history")\
        .select("action, genre_scores, tmdb_id")\
        .eq("user_id", user_id)\
        .execute()

    seen_ids = set()
    for row in swipes.data or []:
        seen_ids.add(row["tmdb_id"])
        if row.get("genre_scores") and isinstance(row["genre_scores"], dict):
            weight = SWIPE_WEIGHTS.get(row["action"], 0)
            for genre, score in row["genre_scores"].items():
                genre_scores[genre] = genre_scores.get(genre, 0) + (score * weight)

    # Signal 2 — journal personal ratings
    journal = supabase.from_("journal_entries")\
        .select("tmdb_id, personal_rating")\
        .eq("user_id", user_id)\
        .not_.is_("personal_rating", "null")\
        .execute()

    for entry in journal.data or []:
        seen_ids.add(entry["tmdb_id"])
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

    # Signal 3 — watchlist saves (implicit positive signal)
    watchlist = supabase.from_("collection_movies")\
        .select("tmdb_id, collections!inner(user_id, is_default)")\
        .eq("collections.user_id", user_id)\
        .eq("collections.is_default", True)\
        .execute()

    for item in watchlist.data or []:
        seen_ids.add(item["tmdb_id"])
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
    return genre_scores, seen_ids


def fetch_candidate_movies(genre_scores):
    candidates = []
    seen_candidate_ids = set()

    # Get top 3 preferred genres
    top_genres = sorted(genre_scores.items(), key=lambda x: -x[1])[:3]
    genre_name_to_id = {v: k for k, v in GENRE_MAP.items()}

    for genre_name, score in top_genres:
        if score <= 0:
            continue
        genre_id = genre_name_to_id.get(genre_name)
        if not genre_id:
            continue
        for page in range(1, CANDIDATE_PAGES + 1):
            url = f"{TMDB_BASE}/discover/movie"
            params = {
                "api_key": TMDB_API_KEY,
                "with_genres": genre_id,
                "sort_by": "popularity.desc",
                "vote_count.gte": 100,
                "page": page
            }
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code != 200:
                continue
            for m in resp.json().get("results", []):
                if m["id"] not in seen_candidate_ids:
                    seen_candidate_ids.add(m["id"])
                    candidates.append(m)

    # Fallback — if no strong genre preference, fetch popular films
    if not candidates:
        for page in range(1, 4):
            url = f"{TMDB_BASE}/movie/popular"
            params = {"api_key": TMDB_API_KEY, "page": page}
            resp = requests.get(url, params=params, timeout=10)
            if resp.status_code == 200:
                for m in resp.json().get("results", []):
                    if m["id"] not in seen_candidate_ids:
                        seen_candidate_ids.add(m["id"])
                        candidates.append(m)

    print(f"[recommender] Fetched {len(candidates)} candidate movies")
    return candidates


def score_movie(movie, genre_scores):
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

    return score


def write_recommendations(supabase, user_id, scored_movies):
    # Delete old recommendations for this user
    supabase.from_("recommendations")\
        .delete()\
        .eq("user_id", user_id)\
        .execute()

    # Insert new recommendations
    rows = []
    for movie, score in scored_movies[:MAX_RECOMMENDATIONS]:
        genre_ids = movie.get("genre_ids", [])
        top_genre = GENRE_MAP.get(genre_ids[0]) if genre_ids else None
        reason = f"Matches your taste in {top_genre}" if top_genre else "Highly rated pick"
        rows.append({
            "user_id": user_id,
            "tmdb_id": movie["id"],
            "score": round(score, 4),
            "reason": reason,
            "generated_at": datetime.now(timezone.utc).isoformat()
        })

    if rows:
        supabase.from_("recommendations").insert(rows).execute()
        print(f"[recommender] Wrote {len(rows)} recommendations for user {user_id[:8]}...")


def process_user(supabase, user_id):
    try:
        genre_scores, seen_ids = build_taste_profile(supabase, user_id)
        candidates = fetch_candidate_movies(genre_scores)

        # Filter out already seen movies
        unseen = [m for m in candidates if m["id"] not in seen_ids]

        # Score all unseen candidates
        scored = [(m, score_movie(m, genre_scores)) for m in unseen]
        scored.sort(key=lambda x: -x[1])

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
