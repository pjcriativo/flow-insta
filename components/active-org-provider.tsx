"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/auth-provider";

export type Organization = {
  id: string;
  name: string;
  type: "personal" | "team";
  role: "owner" | "admin" | "member";
};

type ActiveOrgContextValue = {
  orgs: Organization[];
  activeOrg: Organization | null;
  activeOrgId: string | null;
  role: Organization["role"] | null;
  isLoading: boolean;
  switchOrg: (orgId: string) => Promise<void>;
  refetch: () => void;
};

const ActiveOrgContext = createContext<ActiveOrgContextValue>({
  orgs: [],
  activeOrg: null,
  activeOrgId: null,
  role: null,
  isLoading: true,
  switchOrg: async () => {},
  refetch: () => {},
});

export function ActiveOrgProvider({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useAuthUser();
  const queryClient = useQueryClient();
  const router = useRouter();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["orgs"],
    enabled: isSignedIn,
    queryFn: async () => {
      const res = await fetch("/api/org");
      if (!res.ok) throw new Error("Failed to load organizations");
      const json = await res.json();
      return {
        organizations: (json.organizations ?? []) as Organization[],
        activeOrgId: (json.activeOrgId ?? null) as string | null,
      };
    },
  });

  const orgs = useMemo(() => data?.organizations ?? [], [data]);

  // A org ativa é resolvida pelo servidor (cookie + validação de membership).
  const activeOrg =
    orgs.find((o) => o.id === data?.activeOrgId) ?? orgs[0] ?? null;

  const switchOrg = async (orgId: string) => {
    const res = await fetch("/api/org/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId }),
    });
    if (!res.ok) return;
    // Zera o cache para não vazar dados do tenant anterior e recarrega.
    queryClient.clear();
    router.refresh();
  };

  const value: ActiveOrgContextValue = {
    orgs,
    activeOrg,
    activeOrgId: activeOrg?.id ?? null,
    role: activeOrg?.role ?? null,
    isLoading,
    switchOrg,
    refetch,
  };

  return (
    <ActiveOrgContext.Provider value={value}>
      {children}
    </ActiveOrgContext.Provider>
  );
}

export function useActiveOrg() {
  return useContext(ActiveOrgContext);
}
