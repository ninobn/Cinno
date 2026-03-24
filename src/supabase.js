import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials missing. Auth features will not work.");
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ─── RLS Policy Requirements (Phase 2) ─────────────────────────────────────────
//
// When database tables are created, Row Level Security (RLS) MUST be enabled on
// every table. Apply these policies:
//
// 1. SELECT — users can only read their own rows:
//    CREATE POLICY "select_own" ON <table> FOR SELECT
//      USING (auth.uid() = user_id);
//
// 2. INSERT — users can only insert rows with their own user_id:
//    CREATE POLICY "insert_own" ON <table> FOR INSERT
//      WITH CHECK (auth.uid() = user_id);
//
// 3. UPDATE — users can only update their own rows:
//    CREATE POLICY "update_own" ON <table> FOR UPDATE
//      USING (auth.uid() = user_id)
//      WITH CHECK (auth.uid() = user_id);
//
// 4. DELETE — users can only delete their own rows:
//    CREATE POLICY "delete_own" ON <table> FOR DELETE
//      USING (auth.uid() = user_id);
//
// 5. Guest users (unauthenticated) have NO database access.
//    RLS with auth.uid() checks inherently blocks guests since they have no JWT.
//
// Tables requiring these policies:
//   - watchlist, journal, collections, collection_movies,
//     chat_conversations, user_preferences
//
// IMPORTANT: Never disable RLS. Never use the service_role key in frontend code.
// The anon key used here is safe for client-side — it relies on RLS for security.
// ────────────────────────────────────────────────────────────────────────────────
