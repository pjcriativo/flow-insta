import AtomizeWizard from "./_components/atomize-wizard";

export const metadata = {
  title: "Atomizar vídeo",
};

export default function AtomizarPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Atomizar vídeo</h1>
        <p className="text-sm text-muted-foreground">
          Cole um link do YouTube e a IA recorta os melhores trechos em Reels,
          carrossel e story na voz da sua marca.
        </p>
      </div>
      <AtomizeWizard />
    </div>
  );
}
