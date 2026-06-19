import { CreditCard } from "lucide-react";

const BillingPage = () => {
  return (
    <div className="w-full max-w-6xl px-6 py-6 mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie sua assinatura e informações de cobrança.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <CreditCard className="size-6 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-lg font-medium">Planos em breve</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          No momento todos os recursos estão liberados. A cobrança por planos
          será adicionada em uma próxima etapa.
        </p>
      </div>
    </div>
  );
};

export default BillingPage;
