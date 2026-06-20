import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Testes de integração batem no Supabase real (RLS) — precisam de rede e do
// .env. Rodam em série (single fork) porque criam/derrubam orgs e usuários
// compartilhados; paralelismo causaria corrida no setup/teardown.
export default defineConfig({
  resolve: {
    alias: {
      // Espelha o paths "@/*" do tsconfig para o resolver do Vitest.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
