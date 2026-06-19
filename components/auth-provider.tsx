"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type AuthContextValue = {
  user: User | null;
  isLoading: boolean;
  isSignedIn: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isSignedIn: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isSignedIn: !!user, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Replacement for Clerk's useUser/useAuth — exposes the Supabase auth user. */
export function useAuthUser() {
  return useContext(AuthContext);
}
