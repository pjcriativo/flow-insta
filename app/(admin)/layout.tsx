import { redirect } from "next/navigation";
import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/supabase-server";
import Logo from "@/components/logo";

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
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Logo />
            <span className="text-sm font-medium text-muted-foreground">Admin</span>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/admin" className="hover:text-foreground text-muted-foreground">
                Overview
              </Link>
              <Link href="/admin/users" className="hover:text-foreground text-muted-foreground">
                Usuários
              </Link>
              <Link href="/admin/orgs" className="hover:text-foreground text-muted-foreground">
                Organizações
              </Link>
            </nav>
          </div>
          <Link href="/schedule" className="text-sm text-muted-foreground hover:text-foreground">
            ← Voltar ao app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
