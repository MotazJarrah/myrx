import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { PublicUser } from "@shared/schema";

interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const meQuery = useQuery<{ user: PublicUser } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch(
        ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__") + "/api/auth/me",
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    retry: false,
    staleTime: 1000 * 60,
  });

  const loginMutation = useMutation({
    mutationFn: async (vars: { identifier: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/login", vars);
      return res.json() as Promise<{ user: PublicUser }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (vars: { username: string; email: string; password: string }) => {
      const res = await apiRequest("POST", "/api/auth/register", vars);
      return res.json() as Promise<{ user: PublicUser }>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/auth/me"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/workouts"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      isLoading: meQuery.isLoading,
      login: async (identifier, password) => {
        await loginMutation.mutateAsync({ identifier, password });
      },
      register: async (username, email, password) => {
        await registerMutation.mutateAsync({ username, email, password });
      },
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [meQuery.data, meQuery.isLoading, loginMutation, registerMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
