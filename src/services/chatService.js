import { supabase } from "../supabase.js";

// ─── Supabase Chat CRUD ────────────────────────────────────────────────────────

export async function createConversation(userId, title, metadata = {}) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title, metadata })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getConversations(userId) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getMessages(conversationId) {
  if (!supabase) throw new Error("No Supabase client");
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("timestamp", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function saveMessage(conversationId, role, content) {
  if (!supabase) throw new Error("No Supabase client");
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role, content, timestamp: now })
    .select()
    .single();
  if (error) throw error;
  await supabase
    .from("conversations")
    .update({ updated_at: now })
    .eq("id", conversationId);
  return data;
}

export async function deleteConversation(conversationId) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId);
  if (error) throw error;
}

export async function updateConversationTitle(conversationId, title) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw error;
}

export async function updateConversationMetadata(conversationId, metadata) {
  if (!supabase) throw new Error("No Supabase client");
  const { error } = await supabase
    .from("conversations")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw error;
}

// ─── Bulk load: conversations + messages in 2 queries ──────────────────────────

export async function loadAllChats(userId) {
  const conversations = await getConversations(userId);
  if (conversations.length === 0) return [];

  const ids = conversations.map((c) => c.id);
  const { data: allMessages, error } = await supabase
    .from("messages")
    .select("*")
    .in("conversation_id", ids)
    .order("timestamp", { ascending: true });
  if (error) throw error;

  const msgMap = {};
  for (const msg of allMessages || []) {
    if (!msgMap[msg.conversation_id]) msgMap[msg.conversation_id] = [];
    msgMap[msg.conversation_id].push({
      role: msg.role,
      content: msg.content,
      ts: new Date(msg.timestamp).getTime(),
    });
  }

  return conversations.map((c) => ({
    id: c.id,
    title: c.title,
    messages: msgMap[c.id] || [],
    ...(c.metadata || {}),
  }));
}

// ─── One-time migration: localStorage → Supabase ──────────────────────────────

export async function migrateLocalStorageChats(userId, localChats) {
  if (!supabase || !localChats?.length) return null;

  // Skip if user already has conversations in Supabase
  const existing = await getConversations(userId);
  if (existing.length > 0) return null;

  const migrated = [];
  for (const chat of localChats) {
    try {
      const metadata = {};
      if (chat.pickerMode) metadata.pickerMode = chat.pickerMode;
      if (chat.pickerContext) metadata.pickerContext = chat.pickerContext;
      if (chat.movieContext) metadata.movieContext = chat.movieContext;

      const conv = await createConversation(userId, chat.title || "New chat", metadata);

      if (chat.messages?.length > 0) {
        const msgs = chat.messages.map((m) => ({
          conversation_id: conv.id,
          role: m.role,
          content: m.content,
          timestamp: m.ts ? new Date(m.ts).toISOString() : new Date().toISOString(),
        }));
        const { error } = await supabase.from("messages").insert(msgs);
        if (error) console.error("Failed to migrate messages for chat:", chat.id, error);
      }

      migrated.push({ oldId: chat.id, newId: conv.id });
    } catch (e) {
      console.error("Failed to migrate chat:", chat.id, e);
    }
  }

  return migrated;
}
