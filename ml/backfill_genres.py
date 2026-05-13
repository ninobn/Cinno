"""
One-time backfill: populate genre_ids on movies_cache rows that have empty or
null genre_ids by hitting TMDB /movie/{id}, then propagate the same genre_ids
onto any matching rows in the recommendations table.

Run locally:
    python ml/backfill_genres.py

Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, TMDB_API_KEY in env or .env.
"""

import os
import sys
import time
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY")
TMDB_BASE = "https://api.themoviedb.org/3"

# Stay well under TMDB's 50 req/s ceiling.
TMDB_REQUEST_DELAY_SEC = 0.05

# Cap on how many movies_cache rows we read in one shot. Personal app caches
# are well under this; bump or paginate if you've ever scaled past 10k films.
PAGE_LIMIT = 10000


def fetch_movies_to_backfill(supabase):
    """Return movies_cache rows where genre_ids is null or empty.

    Filtering happens client-side to dodge PostgREST quirks around empty-array
    literals across supabase-py versions — fine for a one-time script."""
    result = supabase.from_("movies_cache")\
        .select("tmdb_id, title, genre_ids")\
        .limit(PAGE_LIMIT)\
        .execute()
    rows = result.data or []
    return [r for r in rows if not r.get("genre_ids") or len(r["genre_ids"]) == 0]


def fetch_tmdb_genre_ids(tmdb_id):
    """Hit TMDB /movie/{id} and return its genre_ids list. Raises on failure."""
    url = f"{TMDB_BASE}/movie/{tmdb_id}"
    params = {"api_key": TMDB_API_KEY}
    resp = requests.get(url, params=params, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"TMDB returned {resp.status_code}: {resp.text[:120]}")
    data = resp.json()
    return [g["id"] for g in data.get("genres", []) if "id" in g]


def update_movies_cache(supabase, tmdb_id, genre_ids):
    supabase.from_("movies_cache")\
        .update({"genre_ids": genre_ids})\
        .eq("tmdb_id", tmdb_id)\
        .execute()


def update_recommendations(supabase, tmdb_id, genre_ids):
    """Sync genre_ids onto every recommendation row referencing this tmdb_id
    (could span multiple users)."""
    supabase.from_("recommendations")\
        .update({"genre_ids": genre_ids})\
        .eq("tmdb_id", tmdb_id)\
        .execute()


def main():
    if not (SUPABASE_URL and SUPABASE_SERVICE_KEY and TMDB_API_KEY):
        print("[backfill] ERROR: missing SUPABASE_URL, SUPABASE_SERVICE_KEY, or TMDB_API_KEY in env")
        sys.exit(1)

    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    movies = fetch_movies_to_backfill(supabase)
    total = len(movies)
    print(f"[backfill] Found {total} movies_cache rows with missing/empty genre_ids")
    if total == 0:
        print("[backfill] Nothing to do.")
        return

    updated = 0
    failed = 0
    failed_ids = []

    for i, m in enumerate(movies, start=1):
        tmdb_id = m["tmdb_id"]
        title = m.get("title") or "(untitled)"
        try:
            genre_ids = fetch_tmdb_genre_ids(tmdb_id)
            if not genre_ids:
                print(f"[backfill] [{i}/{total}] {tmdb_id} '{title}': TMDB returned no genres, skipping")
                failed += 1
                failed_ids.append(tmdb_id)
                continue
            update_movies_cache(supabase, tmdb_id, genre_ids)
            update_recommendations(supabase, tmdb_id, genre_ids)
            updated += 1
            print(f"[backfill] [{i}/{total}] {tmdb_id} '{title}': set genre_ids={genre_ids}")
        except Exception as e:
            failed += 1
            failed_ids.append(tmdb_id)
            print(f"[backfill] [{i}/{total}] {tmdb_id} '{title}': ERROR {e}")

        time.sleep(TMDB_REQUEST_DELAY_SEC)

    print()
    print("[backfill] === Summary ===")
    print(f"[backfill] Updated: {updated}")
    print(f"[backfill] Failed:  {failed}")
    if failed_ids:
        print(f"[backfill] Failed tmdb_ids: {failed_ids}")


if __name__ == "__main__":
    main()
