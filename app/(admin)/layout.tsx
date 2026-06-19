import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/supabase-server";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./_common/admin-sidebar";

// Server-side guard: só super-admins de plataforma acessam /admin.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect("/");
  }

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset className="bg-sidebar! border-none">
        <div className="m-1 rounded-lg border border-border dark:border-[#e0e1e11a] shadow-xs bg-background min-h-[calc(100vh-0.5rem)]">
          <header className="flex h-14 items-center gap-2 border-b px-4">
            <SidebarTrigger className="md:hidden" />
            <span className="text-sm font-medium text-muted-foreground">
              Administração
            </span>
          </header>
          <div className="p-6">{children}</div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
