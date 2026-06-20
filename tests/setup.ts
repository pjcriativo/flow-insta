import { config } from "dotenv";

// Carrega o .env do projeto para os testes de integração (Supabase URL/keys,
// APPROVAL_LINK_SECRET, etc.). Roda antes de qualquer teste.
config();
