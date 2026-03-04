import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type UserRole = "admin" | "analyst" | "viewer";

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

type AuthOrganization = {
  name: string;
} | null;

interface AuthState {
  user: AuthUser | null;
  org: AuthOrganization;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function mapRole(value: unknown): UserRole {
  if (value === "admin" || value === "viewer" || value === "analyst") {
    return value;
  }

  return "analyst";
}

function mapUser(user: SupabaseUser): AuthUser {
  const metadata = user.user_metadata ?? {};
  const email = user.email ?? "";

  return {
    id: user.id,
    email,
    displayName:
      typeof metadata.display_name === "string" && metadata.display_name.trim().length > 0
        ? metadata.display_name.trim()
        : typeof metadata.full_name === "string" && metadata.full_name.trim().length > 0
          ? metadata.full_name.trim()
          : email,
    role: mapRole(metadata.role),
  };
}

function mapOrganization(user: SupabaseUser): AuthOrganization {
  const metadata = user.user_metadata ?? {};
  const orgName =
    typeof metadata.org_name === "string" && metadata.org_name.trim().length > 0
      ? metadata.org_name.trim()
      : null;

  return orgName ? { name: orgName } : null;
}

const initialState: AuthState = {
  user: null,
  org: null,
  isLoading: true,
  isAuthenticated: false,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState);

  const checkAuth = useCallback(async () => {
    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error || !session?.user) {
        setState({ user: null, org: null, isLoading: false, isAuthenticated: false });
        return;
      }

      setState({
        user: mapUser(session.user),
        org: mapOrganization(session.user),
        isLoading: false,
        isAuthenticated: true,
      });
    } catch {
      setState({ user: null, org: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  useEffect(() => {
    void checkAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setState({ user: null, org: null, isLoading: false, isAuthenticated: false });
        return;
      }

      setState({
        user: mapUser(session.user),
        org: mapOrganization(session.user),
        isLoading: false,
        isAuthenticated: true,
      });
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [checkAuth]);

  const login = useCallback(async (email: string, password: string) => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      throw new Error("Email and password are required.");
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      throw new Error(error.message || "Authentication failed.");
    }

    await checkAuth();
  }, [checkAuth]);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) {
      throw new Error(error.message || "Logout failed.");
    }

    setState({ user: null, org: null, isLoading: false, isAuthenticated: false });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      login,
      logout,
      checkAuth,
    }),
    [state, login, logout, checkAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return ctx;
}
