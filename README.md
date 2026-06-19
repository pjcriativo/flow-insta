# Flow Insta – Agendamento de Redes Sociais com IA

Plataforma de agendamento de redes sociais com IA. Gerencie múltiplos canais, gere conteúdo com IA, automatize publicações agendadas e organize ideias em um quadro Kanban.

> **Flow Insta** faz parte da suíte de ferramentas **MESTRES DO MVP**.

---

## 🗝️ Funcionalidades

* 🔐 Autenticação com **Clerk**
* 🔗 Conectar e gerenciar contas de redes sociais
* 📱 Suporte a múltiplos canais
* 📝 Criar e gerenciar posts
* 🤖 Assistente de IA para gerar, encurtar, reformular e expandir posts
* 👀 Preview customizado por canal
* 📅 Visualização em Calendário e Lista
* ⏰ Agendamento automático de posts com cron jobs
* 📌 Quadro Kanban para organizar ideias de conteúdo
* ✨ Geração de ideias de conteúdo com IA

## 🧱 Stack

* **Next.js**, **React**
* **Inngest** (jobs em background / agendamento)
* **Clerk** (autenticação)
* **Supabase** (banco de dados PostgreSQL + storage)
* **OpenAI** (geração de conteúdo com IA)
* **Tailwind CSS + Shadcn/UI**

---

## 🚀 Como rodar

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie `.env.example` para `.env` e preencha as variáveis (veja abaixo).

3. Crie um projeto no **Supabase** e rode os scripts SQL em [`lib/db/`](lib/db/) no SQL Editor:
   - `create-social-scheduling-tables.sql`
   - `fix-channel-types-rls.sql`
   - `storage-bucket.sql`

4. Configure o **Clerk como Third-Party Auth** no Supabase
   (Supabase → Authentication → Third-party Auth → Clerk) para o RLS funcionar.

5. Rode a aplicação:

   ```bash
   npm run dev
   ```

6. (Opcional) Para o agendamento de posts em desenvolvimento, rode o Inngest dev server:

   ```bash
   npx inngest-cli@latest dev
   ```

---

## ⚙️ Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais:

- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **OpenAI** — `OPENAI_API_KEY` (e `OPENAI_MODEL`, opcional)
- **Clerk** — publishable key e secret key
- **Segredos de criptografia** — `CHANNEL_OAUTH_STATE_SECRET` e `CHANNEL_TOKEN_ENCRYPTION_KEY`
- **OAuth dos canais** — client id/secret de cada rede social (ex.: Twitter/X)

---

## 👨‍💻 Desenvolvimento

Desenvolvido por **MESTRES DO MVP** — parte da suíte de ferramentas MESTRES DO MVP.
