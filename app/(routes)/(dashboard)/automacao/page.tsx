import { getActiveOrg } from "@/lib/supabase-server";
import AutomationPanel, { type ChannelOption } from "./_components/automation-panel";

export const metadata = {
  title: "Automação de DM",
};

// Server Component: carrega os canais da org (RLS) e entrega ao painel cliente.
// As configs/regras/funil/FAQ são buscadas client-side via react-query.
export default async function AutomacaoPage() {
  const { supabase, orgId, role } = await getActiveOrg();

  const { data: channels } = await supabase
    .from("user_channels")
    .select("id, handle, channel_types(type, name)")
    .eq("org_id", orgId)
    .eq("is_connected", true);

  const options: ChannelOption[] = (channels ?? []).map((c) => {
    const t = c.channel_types as unknown as { type: string; name: string } | null;
    return {
      id: c.id as string,
      handle: (c.handle as string | null) ?? null,
      typeName: t?.name ?? "Canal",
    };
  });

  const canEdit = role === "owner" || role === "admin";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Piloto de DM/Comentário</h1>
        <p className="text-sm text-muted-foreground">
          A IA responde comentários e DMs do Instagram na voz da sua marca,
          qualifica intenção de compra e conduz o funil — com kill-switch,
          revisão humana e compliance da Meta.
        </p>
      </div>
      <AutomationPanel channels={options} canEdit={canEdit} />
    </div>
  );
}
