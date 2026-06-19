"use client";

import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";

// Banner de aviso global, controlado pelo admin em /admin/settings.
export function AnnouncementBanner() {
  const { data } = useQuery({
    queryKey: ["public-settings"],
    queryFn: async () => {
      const res = await fetch("/api/public-settings");
      return res.json() as Promise<{ announcement: { text: string; enabled: boolean } }>;
    },
    staleTime: 60_000,
  });

  const ann = data?.announcement;
  if (!ann?.enabled || !ann.text) return null;

  return (
    <div className="flex items-center gap-2 bg-primary/10 px-4 py-2 text-sm text-primary">
      <Megaphone className="size-4 shrink-0" />
      <span>{ann.text}</span>
    </div>
  );
}
