import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase.js";

const AuthContext = createContext(null);

const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const ACTIVITY_STORAGE_KEY = "cc_last_activity";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [signInCooldown, setSignInCooldown] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const sessionRef = useRef(null);
  const onSignOutRef = useRef(null);
  const inactivityTimerRef = useRef(null);

  // Record user activity (throttled — writes at most once per minute)
  const lastWriteRef = useRef(0);
  const recordActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < 60000) return;
    lastWriteRef.current = now;
    try { localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now)); } catch {}
  }, []);

  // Check if inactivity timeout has been exceeded
  const checkInactivityTimeout = useCallback(() => {
    try {
      const last = parseInt(localStorage.getItem(ACTIVITY_STORAGE_KEY) || "0", 10);
      if (last > 0 && Date.now() - last > INACTIVITY_TIMEOUT_MS) {
        return true;
      }
    } catch {}
    return false;
  }, []);

  // Full sign-out: clears supabase session + notifies app to clear state
  const signOut = useCallback(async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    sessionRef.current = null;
    setUser(null);
    setIsGuest(false);
    clearTimeout(inactivityTimerRef.current);
    try { localStorage.removeItem(ACTIVITY_STORAGE_KEY); } catch {}
    // Notify App to clear all cached data
    if (onSignOutRef.current) onSignOutRef.current();
  }, []);

  // Reset inactivity timer whenever activity is recorded
  const resetInactivityTimer = useCallback(() => {
    clearTimeout(inactivityTimerRef.current);
    if (!sessionRef.current?.user) return;
    inactivityTimerRef.current = setTimeout(() => {
      signOut();
    }, INACTIVITY_TIMEOUT_MS);
  }, [signOut]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check for existing session (wrapped in try/catch for mobile OAuth redirect edge cases)
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        console.warn("getSession error (may happen on OAuth redirect):", error.message);
        // Don't block — onAuthStateChange will pick up the session
        setLoading(false);
        return;
      }
      // If session exists but user was inactive too long, force sign out
      if (session?.user && checkInactivityTimeout()) {
        supabase.auth.signOut();
        sessionRef.current = null;
        setUser(null);
        setLoading(false);
        return;
      }
      sessionRef.current = session;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session?.user) {
        recordActivity();
        resetInactivityTimer();
      }
    }).catch((err) => {
      console.warn("getSession threw:", err);
      setLoading(false);
    });

    // Listen for auth state changes including token refresh failures
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Token refresh failed — force logout immediately
      if (event === "TOKEN_REFRESHED" && !session) {
        sessionRef.current = null;
        setUser(null);
        setIsGuest(false);
        return;
      }

      // User was signed out (manually or by Supabase)
      if (event === "SIGNED_OUT") {
        sessionRef.current = null;
        setUser(null);
        setIsGuest(false);
        clearTimeout(inactivityTimerRef.current);
        return;
      }

      sessionRef.current = session;
      setUser(session?.user ?? null);
      if (session?.user) {
        setIsGuest(false);
        recordActivity();
        resetInactivityTimer();
      }
    });

    // Track user activity for inactivity timeout
    const activityEvents = ["mousedown", "keydown", "touchstart", "scroll"];
    const onActivity = () => {
      recordActivity();
      resetInactivityTimer();
    };
    activityEvents.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    return () => {
      subscription.unsubscribe();
      activityEvents.forEach((evt) => window.removeEventListener(evt, onActivity));
      clearTimeout(inactivityTimerRef.current);
    };
  }, [checkInactivityTimeout, recordActivity, resetInactivityTimer]);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase || signInCooldown) return;
    setSignInError(null);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch {
      setSignInError("Sign in failed. Please try again.");
      setSignInCooldown(true);
      setTimeout(() => setSignInCooldown(false), 3000);
    }
  }, [signInCooldown]);

  const continueAsGuest = useCallback(() => {
    setIsGuest(true);
  }, []);

  // Re-validates current session — checks sessionRef which is kept in sync
  // by onAuthStateChange. For critical operations, call getSession() directly.
  const isAuthenticated = useCallback(() => {
    return !!sessionRef.current?.user;
  }, []);

  // Returns the current access token for authenticated API calls
  const getAccessToken = useCallback(() => {
    return sessionRef.current?.access_token || null;
  }, []);

  // Allow App to register a callback for clearing all state on sign-out
  const registerSignOutCallback = useCallback((cb) => {
    onSignOutRef.current = cb;
  }, []);

  const value = {
    user,
    loading,
    isGuest,
    signInCooldown,
    signInError,
    signInWithGoogle,
    signOut,
    continueAsGuest,
    isAuthenticated,
    getAccessToken,
    registerSignOutCallback,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
