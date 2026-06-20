import ReviewQueue from "./_components/review-queue";

export const metadata = {
  title: "Fila de revisão",
};

export default function ReviewPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fila de revisão</h1>
        <p className="text-sm text-muted-foreground">
          Respostas sugeridas pela IA que precisam de aprovação humana antes de
          serem enviadas. Aprovar ou editar dispara o envio; rejeitar descarta.
        </p>
      </div>
      <ReviewQueue />
    </div>
  );
}
