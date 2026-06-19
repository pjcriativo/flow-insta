import { ShieldAlert } from "lucide-react";

// Mensagem genérica — NÃO revela se a coleção existe, expirou ou foi revogada.
export function InvalidLink() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <ShieldAlert className="size-6 text-muted-foreground" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Link inválido</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Este link de aprovação não é válido ou não está mais disponível.
          Solicite um novo link a quem o enviou.
        </p>
      </div>
    </div>
  );
}
