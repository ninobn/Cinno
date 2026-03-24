import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "./supabase.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [signInCooldown, setSignInCooldown] = useState(false);
  const [signInError, setSignInError] = useState(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      sessionRef.current = session;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      sessionRef.current = session;
      setUser(session?.user ?? null);
      if (session?.user) {
        setIsGuest(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

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
      // 3-second cooldown after failed attempt
      setSignInCooldown(true);
      setTimeout(() => setSignInCooldown(false), 3000);
    }
  }, [signInCooldown]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    sessionRef.current = null;
    setUser(null);
    setIsGuest(false);
  }, []);

  const continueAsGuest = useCallback(() => {
    setIsGuest(true);
  }, []);

  // Re-validates current session - used by restriction checks
  const isAuthenticated = useCallback(() => {
    return !!sessionRef.current?.user;
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
