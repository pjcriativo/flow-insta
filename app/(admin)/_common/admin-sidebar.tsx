"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Logo from "@/components/logo";
import { LayoutDashboard, Users, Building2, ArrowLeft, ShieldCheck } from "lucide-react";

const nav = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Usuários", href: "/admin/users", icon: Users },
  { name: "Organizações", href: "/admin/orgs", icon: Building2 },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <Logo />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-primary/10 px-2 py-1.5 text-xs font-medium text-primary">
          <ShieldCheck className="size-4" />
          Painel de Administração
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel>Plataforma</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const active =
                  item.href === "/admin"
                    ? pathname === "/admin"
                    : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.name}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.name}>
                      <Link href={item.href}>
                        <item.icon className="size-4" />
                        <span className="text-sm">{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Voltar ao app">
              <Link href="/schedule">
                <ArrowLeft className="size-4" />
                <span className="text-sm">Voltar ao app</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
