"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoreHorizontal, Search, ShieldCheck, ShieldOff, Trash2, Download, Ban, CircleCheck } from "lucide-react";
import { toast } from "sonner";

type AdminUser = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmed: boolean;
  isPlatformAdmin: boolean;
  banned: boolean;
};

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<AdminUser | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<AdminUser[]> => {
      const res = await fetch("/api/admin/users");
      return (await res.json()).users ?? [];
    },
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return data ?? [];
    return (data ?? []).filter((u) => u.email?.toLowerCase().includes(q));
  }, [data, search]);

  const toggleAdmin = useMutation({
    mutationFn: async ({ id, makeAdmin }: { id: string; makeAdmin: boolean }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPlatformAdmin: makeAdmin }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Permissão atualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleBan = useMutation({
    mutationFn: async ({ id, banned }: { id: string; banned: boolean }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banned }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha");
    },
    onSuccess: (_d, { banned }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(banned ? "Usuário suspenso" : "Usuário reativado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Falha");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setToDelete(null);
      toast.success("Usuário excluído");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os usuários da plataforma.
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href="/api/admin/export?type=users">
            <Download className="size-4" /> Exportar CSV
          </a>
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por e-mail…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">
            {isLoading ? "Carregando…" : `${filtered.length} usuário(s)`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <>
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nenhum usuário encontrado.
            </p>
          ) : (
            filtered.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 rounded-lg border p-3 text-sm"
              >
                <Avatar className="size-9">
                  <AvatarFallback className="text-xs uppercase">
                    {u.email?.[0] ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{u.email}</span>
                    {u.isPlatformAdmin && (
                      <Badge className="gap-1">
                        <ShieldCheck className="size-3" /> Admin
                      </Badge>
                    )}
                    {u.banned && (
                      <Badge variant="destructive" className="gap-1">
                        <Ban className="size-3" /> Suspenso
                      </Badge>
                    )}
                    {!u.confirmed && <Badge variant="outline">não confirmado</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Criado {new Date(u.createdAt).toLocaleDateString()}
                    {u.lastSignInAt &&
                      ` · último acesso ${new Date(u.lastSignInAt).toLocaleDateString()}`}
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {u.isPlatformAdmin ? (
                      <DropdownMenuItem
                        onClick={() => toggleAdmin.mutate({ id: u.id, makeAdmin: false })}
                      >
                        <ShieldOff className="size-4" /> Remover admin
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        onClick={() => toggleAdmin.mutate({ id: u.id, makeAdmin: true })}
                      >
                        <ShieldCheck className="size-4" /> Tornar admin
                      </DropdownMenuItem>
                    )}
                    {u.banned ? (
                      <DropdownMenuItem onClick={() => toggleBan.mutate({ id: u.id, banned: false })}>
                        <CircleCheck className="size-4" /> Reativar usuário
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={() => toggleBan.mutate({ id: u.id, banned: true })}>
                        <Ban className="size-4" /> Suspender usuário
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setToDelete(u)}
                    >
                      <Trash2 className="size-4" /> Excluir usuário
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir <strong>{toDelete?.email}</strong>? Esta
              ação é permanente e remove a conta e os dados pessoais do usuário.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUser.isPending}
              onClick={() => toDelete && deleteUser.mutate(toDelete.id)}
            >
              {deleteUser.isPending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
