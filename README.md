# Flow Insta – Agendamento de Redes Sociais com IA

Plataforma de agendamento de redes sociais com IA. Gerencie múltiplos canais, gere conteúdo com IA, automatize publicações agendadas e organize ideias em um quadro Kanban.

> **Flow Insta** faz parte da suíte de ferramentas **MESTRES DO MVP**.

---

## 🗝️ Funcionalidades

* 🔐 Autenticação com **Supabase Auth** (e-mail e senha)
* 🏢 **Multi-tenancy** por organização — B2C (conta pessoal) e B2B (equipes com papéis e convites)
* 👮 **Área de admin** da plataforma (`/admin`) para super-admins
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
* **Supabase** (banco PostgreSQL + storage + **Auth** e-mail/senha)
* **OpenAI** (geração de conteúdo com IA)
* **Tailwind CSS + Shadcn/UI**

---

## 🚀 Como rodar

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Copie `.env.example` para `.env` e preencha as variáveis (veja abaixo).

3. Crie um projeto no **Supabase** e rode os scripts SQL em [`lib/db/`](lib/db/) no SQL Editor, **nesta ordem**:
   - `create-social-scheduling-tables.sql`
   - `fix-channel-types-rls.sql`
   - `storage-bucket.sql`
   - `create-org-multitenancy.sql` (organizações, RLS por org, trigger de signup)

4. No Supabase, habilite **Email/Password** em Authentication → Providers.
   (Para desenvolvimento, desative a confirmação de e-mail em Authentication →
   Sign In / Providers para entrar logo após o cadastro.)

5. Rode a aplicação:

   ```bash
   npm run dev
   ```

6. (Opcional) Para o agendamento de posts em desenvolvimento, rode o Inngest dev server:

   ```bash
   npx inngest-cli@latest dev
   ```

---

## 🏢 Organizações e multi-tenancy

- Todo usuário ganha uma **organização pessoal** automaticamente no cadastro (B2C, invisível).
- Para **equipes (B2B)**: use o seletor de organização na barra lateral → "Criar organização".
  Em Settings → Team é possível **convidar membros** (gera um link `/invite/<token>`),
  gerenciar papéis (owner/admin/member) e remover membros.
- Os dados (canais, posts, ideias) são isolados por organização via **RLS** no banco.

## 👮 Área de admin

A área `/admin` (métricas, usuários, organizações) é restrita a **super-admins**.
Para tornar um usuário super-admin, insira o `user_id` dele na tabela `platform_admins`
(via Supabase SQL Editor) — não há auto-promoção pela interface:

```sql
insert into public.platform_admins (user_id) values ('<auth-user-id>');
```

---

## ⚙️ Variáveis de ambiente

Veja `.env.example` para a lista completa. As principais:

- **Supabase** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **OpenAI** — `OPENAI_API_KEY` (e `OPENAI_MODEL`, opcional)
- **Segredos de criptografia** — `CHANNEL_OAUTH_STATE_SECRET` e `CHANNEL_TOKEN_ENCRYPTION_KEY`
- **OAuth dos canais** — client id/secret de cada rede social (ex.: Twitter/X)

> **Clerk:** a autenticação por Clerk foi desativada (pouco usada no Brasil). O
> pacote `@clerk/nextjs` continua instalado e as variáveis `CLERK_*` ficam no
> `.env.example` para reativação futura. Veja `docs/clerk-reativacao.md`.

---

## 👨‍💻 Desenvolvimento

Desenvolvido por **MESTRES DO MVP** — parte da suíte de ferramentas MESTRES DO MVP.
