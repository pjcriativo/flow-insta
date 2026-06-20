// ============================================================
// Janela de mensagens de 24h da Meta (Human Agent / standard messaging).
//
// INVARIANTE #6: antes de QUALQUER DM, checar window_expires_at. Fora da
// janela, só mensagem com tag permitida e SEM conteúdo promocional.
//
// A janela abre a cada mensagem de ENTRADA do usuário e dura 24h. Guardamos
// window_expires_at em conversations; aqui só interpretamos o estado.
// ============================================================

export const WINDOW_HOURS = 24;

export type WindowState = {
  /** Dentro da janela de 24h: pode enviar conteúdo livre (inclui promo). */
  open: boolean;
  /** Quando a janela expira (ISO) — null se nunca houve entrada. */
  expiresAt: string | null;
};

/**
 * Avalia a janela a partir do window_expires_at da conversa, comparado a
 * `nowMs` (injetado — runners passam Date.now() da borda; mantém testável).
 */
export function evaluateWindow(windowExpiresAt: string | null, nowMs: number): WindowState {
  if (!windowExpiresAt) return { open: false, expiresAt: null };
  const expires = new Date(windowExpiresAt).getTime();
  return { open: Number.isFinite(expires) && expires > nowMs, expiresAt: windowExpiresAt };
}

/** window_expires_at após uma entrada agora (abre/renova a janela de 24h). */
export function windowExpiryFromInbound(nowMs: number): string {
  return new Date(nowMs + WINDOW_HOURS * 3600_000).toISOString();
}

/**
 * Decide se um envio de DM é permitido.
 * - Dentro da janela: sempre permitido (promo incluída).
 * - Fora da janela: só se `hasAllowedTag` (message tag permitida) E
 *   `isPromotional` for false. INVARIANTE #6.
 */
export function canSendDm(args: {
  window: WindowState;
  isPromotional: boolean;
  hasAllowedTag?: boolean;
}): { allowed: boolean; reason: string } {
  if (args.window.open) return { allowed: true, reason: "within_window" };
  if (args.isPromotional) {
    return { allowed: false, reason: "outside_window_promotional" };
  }
  if (args.hasAllowedTag) return { allowed: true, reason: "outside_window_tagged" };
  return { allowed: false, reason: "outside_window_no_tag" };
}
