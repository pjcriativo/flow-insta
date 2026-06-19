"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Video, AlertCircle, CheckCircle2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseYouTubeId } from "@/lib/atomization/youtube";

type Preview = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string;
};

function formatDuration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AtomizeWizard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Settings
  const [rightsAttested, setRightsAttested] = useState(false);
  const [clipCount, setClipCount] = useState("5");
  const [autoSchedule, setAutoSchedule] = useState(false);

  // Validação leve client-side (não substitui a do servidor).
  const looksLikeYouTube = useMemo(
    () => url.trim().length > 0 && parseYouTubeId(url) !== null,
    [url]
  );

  // Preview com debounce: busca metadados quando a URL parece válida.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!looksLikeYouTube) {
      setLoadingPreview(false);
      return;
    }
    setLoadingPreview(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/atomization/preview?url=${encodeURIComponent(url.trim())}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!res.ok) {
          setPreview(null);
          setPreviewError(data.error ?? "Não foi possível validar o vídeo");
        } else {
          setPreview(data as Preview);
          setPreviewError(null);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setPreviewError("Não foi possível validar o vídeo");
        }
      } finally {
        setLoadingPreview(false);
      }
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(t);
    };
  }, [url, looksLikeYouTube]);

  const createJob = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/atomization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_url: url.trim(),
          rights_attested: true,
          settings: {
            clip_count: Number(clipCount),
            auto_schedule: autoSchedule,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Falha ao criar");
      return data as { id: string };
    },
    onSuccess: ({ id }) => {
      toast.success("Atomização iniciada");
      router.push(`/atomizar/${id}`);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  // O botão só habilita com vídeo válido + atestado marcado.
  const canSubmit =
    !!preview && rightsAttested && !createJob.isPending && !loadingPreview;

  const inlineUrlError =
    url.trim().length > 0 && !looksLikeYouTube
      ? "Cole um link do YouTube (watch, youtu.be, shorts ou embed)."
      : previewError;

  return (
    <div className="space-y-5">
      {/* 1) URL */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label htmlFor="yt-url">Link do vídeo no YouTube</Label>
          <div className="relative">
            <Video className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="yt-url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="pl-9"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {inlineUrlError && (
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="size-3.5" />
              {inlineUrlError}
            </p>
          )}

          {/* Preview */}
          {loadingPreview && (
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Skeleton className="h-16 w-28 rounded-md" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          )}
          {preview && !loadingPreview && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={preview.thumbnailUrl}
                alt=""
                className="h-16 w-28 rounded-md object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{preview.title}</p>
                <p className="text-sm text-muted-foreground">
                  {preview.channelTitle ?? "Canal desconhecido"}
                  {formatDuration(preview.durationSeconds)
                    ? ` · ${formatDuration(preview.durationSeconds)}`
                    : ""}
                </p>
              </div>
              <CheckCircle2 className="size-5 text-green-600" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2) Configurações */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Quantidade de clips</Label>
              <p className="text-sm text-muted-foreground">
                Quantos trechos a IA vai gerar.
              </p>
            </div>
            <Select value={clipCount} onValueChange={setClipCount}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="auto-schedule">Agendar automaticamente</Label>
              <p className="text-sm text-muted-foreground">
                Distribui os posts no calendário. Desligado, ficam como rascunho.
              </p>
            </div>
            <Switch
              id="auto-schedule"
              checked={autoSchedule}
              onCheckedChange={setAutoSchedule}
            />
          </div>
        </CardContent>
      </Card>

      {/* 3) Atestado de direitos (obrigatório) */}
      <Card>
        <CardContent className="pt-6">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              checked={rightsAttested}
              onCheckedChange={(v) => setRightsAttested(v === true)}
              className="mt-0.5"
            />
            <span className="text-sm text-muted-foreground">
              Declaro que possuo os direitos sobre este vídeo ou autorização para
              reutilizá-lo, e assumo a responsabilidade pelo conteúdo gerado.
            </span>
          </label>
        </CardContent>
      </Card>

      <Button
        size="lg"
        className="w-full"
        disabled={!canSubmit}
        onClick={() => createJob.mutate()}
      >
        {createJob.isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Iniciando…
          </>
        ) : (
          "Atomizar vídeo"
        )}
      </Button>
      {!rightsAttested && preview && (
        <p className="text-center text-xs text-muted-foreground">
          Marque o atestado de direitos para continuar.
        </p>
      )}
    </div>
  );
}
