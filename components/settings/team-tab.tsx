"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveOrg } from "@/components/active-org-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

type Member = { userId: string; email: string | null; role: string; createdAt: string };
type Invitation = { id: string; email: string; role: string; expires_at: string };

export default function TeamTab() {
  const { activeOrg, activeOrgId, role } = useActiveOrg();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");

  const canManage = role === "owner" || role === "admin";
  const isTeam = activeOrg?.type === "team";

  const { data: members } = useQuery({
    queryKey: ["org-members", activeOrgId],
    enabled: !!activeOrgId && isTeam,
    queryFn: async (): Promise<Member[]> => {
      const res = await fetch(`/api/org/${activeOrgId}/members`);
      const json = await res.json();
      return json.members ?? [];
    },
  });

  const { data: invitations } = useQuery({
    queryKey: ["org-invitations", activeOrgId],
    enabled: !!activeOrgId && isTeam && canManage,
    queryFn: async (): Promise<Invitation[]> => {
      const res = await fetch(`/api/org/${activeOrgId}/invitations`);
      const json = await res.json();
      return json.invitations ?? [];
    },
  });

  const inviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/org/${activeOrgId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role: "member" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Falha ao convidar");
      return json as { inviteUrl: string };
    },
    onSuccess: ({ inviteUrl }) => {
      setInviteEmail("");
      queryClient.invalidateQueries({ queryKey: ["org-invitations", activeOrgId] });
      navigator.clipboard?.writeText(inviteUrl).catch(() => {});
      toast.success("Convite criado — link copiado para a área de transferência");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revokeMutation = useMutation({
    mutationFn: async (invId: string) => {
      const res = await fetch(`/api/org/${activeOrgId}/invitations/${invId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Falha ao revogar");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-invitations", activeOrgId] });
      toast.success("Convite revogado");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/org/${activeOrgId}/members/${userId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Falha ao remover membro");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members", activeOrgId] });
      toast.success("Membro removido");
    },
  });

  if (!isTeam) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Equipe</CardTitle>
          <CardDescription>
            Esta é uma conta pessoal. Crie uma organização de equipe (no seletor
            de organização, na barra lateral) para convidar membros.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Convidar membro</CardTitle>
            <CardDescription>
              O convidado recebe um link para entrar nesta organização.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">E-mail</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colega@empresa.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <Button
                onClick={() => inviteEmail.trim() && inviteMutation.mutate(inviteEmail.trim())}
                disabled={inviteMutation.isPending || !inviteEmail.trim()}
              >
                <UserPlus className="size-4" />
                Convidar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
          <CardDescription>Pessoas com acesso a esta organização.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(members ?? []).map((m) => (
            <div
              key={m.userId}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <Avatar className="size-8">
                <AvatarFallback className="text-xs uppercase">
                  {m.email?.[0] ?? "?"}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm">{m.email}</span>
              <Badge variant="secondary">{m.role}</Badge>
              {canManage && m.role !== "owner" && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeMutation.mutate(m.userId)}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {canManage && (invitations ?? []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Convites pendentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(invitations ?? []).map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-lg border p-3"
              >
                <span className="flex-1 truncate text-sm">{inv.email}</span>
                <Badge variant="outline">{inv.role}</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Copiar link"
                  onClick={() => {
                    const url = `${window.location.origin}/invite/`;
                    navigator.clipboard?.writeText(url);
                    toast.message("Use 'Convidar' para gerar um novo link com token");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => revokeMutation.mutate(inv.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
