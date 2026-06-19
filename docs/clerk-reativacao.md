# Reativação do Clerk (autenticação)

A autenticação do Flow Insta usa **Supabase Auth** (e-mail/senha), padrão mais
comum no Brasil. O **Clerk foi desativado**, mas o pacote `@clerk/nextjs`
continua instalado e este documento registra como voltar a usá-lo no futuro.

## O que foi alterado ao desativar o Clerk

| Arquivo | Antes (Clerk) | Agora (Supabase Auth) |
|---|---|---|
| `app/layout.tsx` | `<ClerkProvider>` | `<AuthProvider>` (`components/auth-provider.tsx`) |
| `proxy.ts` (middleware) | `clerkMiddleware` + `auth.protect()` | sessão Supabase via `@supabase/ssr` + redirect p/ `/sign-in` |
| `lib/supabase-server.ts` | token Clerk via `accessToken` callback | `createServerClient` (cookies) + `auth.getUser()` |
| `app/(routes)/sign-in` e `sign-up` | `<SignIn/>` / `<SignUp/>` do Clerk | formulários e-mail/senha próprios |
| Sidebar / Settings / Landing | `useUser`, `UserButton`, `useAuth` | `useAuthUser()` do `auth-provider` |
| Rotas de IA e `post` | `auth()` + `has({plan})` | `getSupabaseServerClient()` (sem trava de plano) |
| `billing` | `<PricingTable/>` do Clerk | placeholder "em breve" |
| Componentes de IA | `useSubscription()` (trava por plano) | `canUseAI = true` (liberado) |

## Como reativar

1. **Banco/RLS:** trocar `requesting_user_id()` para voltar a ler o `sub` do JWT
   do Clerk (já existe fallback para `auth.jwt() ->> 'sub'` na função). Configurar
   o Clerk como Third-Party Auth no Supabase.
2. **Provider:** voltar `<ClerkProvider>` no `app/layout.tsx`.
3. **Middleware:** restaurar `clerkMiddleware` em `proxy.ts`.
4. **Clients:** em `lib/supabase-server.ts`, injetar o token do Clerk via callback
   `accessToken` no `createClient`.
5. **Auth UI:** restaurar `<SignIn/>`/`<SignUp/>` e trocar `useAuthUser()` por
   `useUser`/`useAuth` nos componentes.
6. **Billing:** restaurar `<PricingTable/>` e as checagens `has({plan})` /
   `useSubscription()`.
7. **Env:** preencher as variáveis `CLERK_*` no `.env` (já presentes, em branco,
   no `.env.example`).

> Dica: o histórico git anterior a esta mudança contém a implementação Clerk
> completa, caso precise consultar o código original.
