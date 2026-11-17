import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import type { Me } from "./types";

interface AuthState {
  me: Me | null;
  loading: boolean;
  isSuperAdmin: boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.raw<Me>("GET", "/auth/me");
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.setQueryData(["me"], null);
    });
  }, [qc]);

  const me = meQuery.data ?? null;
  const value: AuthState = {
    me: me && me.role && ADMIN_ROLES.has(me.role.name) ? me : null,
    loading: meQuery.isPending,
    isSuperAdmin: me?.role?.name === "SUPER_ADMIN",
    refresh: () => meQuery.refetch(),
    logout: async () => {
      await api.raw("POST", "/auth/logout").catch(() => undefined);
      // Null the session first so the guard re-renders, then drop cached data.
      // (qc.clear() alone doesn't notify the active "me" observer.)
      qc.setQueryData(["me"], null);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  };

  // A signed-in non-admin (e.g. a driver account) is treated as signed out here.
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
};
