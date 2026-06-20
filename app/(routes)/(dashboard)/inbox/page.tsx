import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ClipboardList } from "lucide-react";
import InboxList from "./_components/inbox-list";

export const metadata = {
  title: "Caixa de entrada",
};

export default function InboxPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Caixa de entrada</h1>
          <p className="text-sm text-muted-foreground">
            Comentários, menções e DMs do Instagram, com a intenção detectada
            pela IA e a ação tomada.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/inbox/review">
            <ClipboardList className="size-4" />
            Fila de revisão
          </Link>
        </Button>
      </div>
      <InboxList />
    </div>
  );
}
