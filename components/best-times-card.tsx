"use client";

import { useQuery } from "@tanstack/react-query";
import { useActiveOrg } from "@/components/active-org-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { WEEKDAY_SHORT, formatHour } from "@/constants/best-times";
import { Clock, Sparkles } from "lucide-react";

type BestTimes = {
  hasHistory: boolean;
  perChannel: {
    type: string;
    slots: { day: number; hour: number; boosted: boolean }[];
  }[];
  personalized: { day: number; hour: number; count: number }[];
};

const CHANNEL_LABEL: Record<string, string> = {
  INSTAGRAM: "Instagram", FACEBOOK: "Facebook", TWITTER: "Twitter / X",
  LINKEDIN: "LinkedIn", THREADS: "Threads", BLUESKY: "Bluesky",
  TIKTOK: "TikTok", YOUTUBE: "YouTube",
};

export function BestTimesCard() {
  const { activeOrgId } = useActiveOrg();
  const { data, isLoading } = useQuery({
    queryKey: ["best-times", activeOrgId],
    queryFn: async (): Promise<BestTimes> => {
      const res = await fetch("/api/best-times");
      return await res.json();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="size-4" /> Melhores horários para postar
        </CardTitle>
        <CardDescription>
          Sugestões por rede{data?.hasHistory ? " + ajustadas ao seu histórico" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            {data?.hasHistory && data.personalized.length > 0 && (
              <div className="rounded-lg border bg-primary/5 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="size-3.5 text-primary" /> Onde você mais publica
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {data.personalized.map((s, i) => (
                    <Badge key={i} variant="secondary">
                      {WEEKDAY_SHORT[s.day]} {formatHour(s.hour)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {(data?.perChannel ?? []).map((ch) => (
                <div key={ch.type}>
                  <div className="mb-1.5 text-sm font-medium">
                    {CHANNEL_LABEL[ch.type] ?? ch.type}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ch.slots.map((s, i) => (
                      <Badge
                        key={i}
                        variant={s.boosted ? "default" : "outline"}
                        title={s.boosted ? "Você costuma ter atividade neste horário" : undefined}
                      >
                        {WEEKDAY_SHORT[s.day]} {formatHour(s.hour)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
