"use client";

import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";

type Branding = {
  logo_path: string | null;
  primary_color: string;
  accent_color: string;
  custom_domain: string | null;
  domain_verified: boolean;
  email_from_name: string | null;
};

export default function BrandPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Branding | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["branding"],
    queryFn: async (): Promise<Branding> => {
      const res = await fetch("/api/branding");
      return (await res.json()).branding;
    },
  });

  const { data: domainInfo, refetch: refetchDomain } = useQuery({
    queryKey: ["branding-domain"],
    queryFn: async () => {
      const res = await fetch("/api/branding/verify-domain");
      return res.json() as Promise<{ domain: string | null; verified: boolean; txtRecord: string | null }>;
    },
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Branding>) => {
      const res = await fetch("/api/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      queryClient.invalidateQueries({ queryKey: ["branding-domain"] });
      toast.success("Marca salva");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyDomain = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/branding/verify-domain", { method: "POST" });
      return (await res.json()) as { verified: boolean };
    },
    onSuccess: ({ verified }) => {
      refetchDomain();
      queryClient.invalidateQueries({ queryKey: ["branding"] });
      toast[verified ? "success" : "error"](
        verified ? "Domínio verificado!" : "Registro TXT ainda não encontrado. Aguarde a propagação do DNS."
      );
    },
  });

  const handleLogoUpload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload-image", { method: "POST", body: fd });
    setUploading(false);
    const json = await res.json();
    if (!res.ok) {
      toast.error("Falha no upload");
      return;
    }
    setForm((f) => (f ? { ...f, logo_path: json.image.key } : f));
    setLogoUrl(json.image.url);
    save.mutate({ logo_path: json.image.key });
  };

  if (isLoading || !form) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Marca (white-label)</h1>
        <p className="text-sm text-muted-foreground">
          Personalize as páginas de aprovação enviadas aos seus clientes.
        </p>
      </div>

      {/* Logo */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logo</CardTitle>
          <CardDescription>Aparece no topo da página de aprovação do cliente.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-lg border bg-muted">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="logo" className="h-full w-full object-contain" />
            ) : form.logo_path ? (
              <CheckCircle2 className="size-5 text-green-500" />
            ) : (
              <Upload className="size-5 text-muted-foreground" />
            )}
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleLogoUpload(e.target.files[0])}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="size-4" /> {uploading ? "Enviando…" : "Enviar logo"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Cores */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cores</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          <ColorField
            label="Cor primária"
            value={form.primary_color}
            onChange={(v) => setForm({ ...form, primary_color: v })}
          />
          <ColorField
            label="Cor de destaque"
            value={form.accent_color}
            onChange={(v) => setForm({ ...form, accent_color: v })}
          />
          <div className="flex items-end">
            <Button onClick={() => save.mutate({ primary_color: form.primary_color, accent_color: form.accent_color })}>
              Salvar cores
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* E-mail */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Remetente de e-mail</CardTitle>
          <CardDescription>Nome exibido nos e-mails de notificação.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="from">Nome do remetente</Label>
            <Input
              id="from"
              value={form.email_from_name ?? ""}
              onChange={(e) => setForm({ ...form, email_from_name: e.target.value })}
              placeholder="Sua Agência"
            />
          </div>
          <Button variant="outline" onClick={() => save.mutate({ email_from_name: form.email_from_name })}>
            Salvar
          </Button>
        </CardContent>
      </Card>

      {/* Domínio próprio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Domínio próprio
            {domainInfo?.verified ? (
              <Badge className="gap-1"><CheckCircle2 className="size-3" /> Verificado</Badge>
            ) : form.custom_domain ? (
              <Badge variant="outline" className="gap-1"><AlertCircle className="size-3" /> Não verificado</Badge>
            ) : null}
          </CardTitle>
          <CardDescription>
            Sirva as páginas de aprovação no seu próprio domínio.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="domain">Domínio</Label>
              <Input
                id="domain"
                value={form.custom_domain ?? ""}
                onChange={(e) => setForm({ ...form, custom_domain: e.target.value })}
                placeholder="aprovacao.suaagencia.com"
              />
            </div>
            <Button variant="outline" onClick={() => save.mutate({ custom_domain: form.custom_domain })}>
              Salvar domínio
            </Button>
          </div>

          {domainInfo?.txtRecord && !domainInfo.verified && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-medium">Para verificar, crie este registro TXT no DNS:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 text-xs">
                  {domainInfo.txtRecord}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard?.writeText(domainInfo.txtRecord ?? "");
                    toast.success("Copiado");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <Button size="sm" onClick={() => verifyDomain.mutate()} disabled={verifyDomain.isPending}>
                {verifyDomain.isPending ? "Verificando…" : "Verificar agora"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 cursor-pointer rounded border"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="w-28 font-mono text-sm" />
      </div>
    </div>
  );
}
