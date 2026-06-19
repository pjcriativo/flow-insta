"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Plus, Building2 } from "lucide-react";
import { useActiveOrg } from "@/components/active-org-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export function OrgSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { orgs, activeOrg, switchOrg, refetch } = useActiveOrg();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  // B2C invisível: se o usuário só tem a org pessoal, não mostra o switcher.
  const hasTeam = orgs.some((o) => o.type === "team");
  if (orgs.length <= 1 && !hasTeam) return null;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    const res = await fetch("/api/org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setCreating(false);
    if (!res.ok) {
      toast.error("Falha ao criar organização");
      return;
    }
    const { organization } = await res.json();
    setCreateOpen(false);
    setName("");
    await refetch();
    toast.success("Organização criada");
    if (organization?.id) await switchOrg(organization.id);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-sm hover:bg-accent transition-colors"
            title={activeOrg?.name}
          >
            <Building2 className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate flex-1 text-left">
                  {activeOrg?.name ?? "Organização"}
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Organizações</DropdownMenuLabel>
          {orgs.map((org) => (
            <DropdownMenuItem
              key={org.id}
              onClick={() => org.id !== activeOrg?.id && switchOrg(org.id)}
              className="gap-2"
            >
              <Building2 className="size-4" />
              <span className="truncate flex-1">{org.name}</span>
              {org.id === activeOrg?.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            Criar organização
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova organização</DialogTitle>
            <DialogDescription>
              Crie uma organização de equipe para compartilhar canais e posts
              com outras pessoas.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="org-name">Nome</Label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Minha Agência"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? "Criando..." : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
