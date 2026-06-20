import type { InteractionType, InteractionStatus, Intent } from "@/types/dm-pilot";

// Linha de interaction_events tal como o runner precisa (campos usados).
export type EventRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  provider: string;
  provider_event_id: string;
  type: InteractionType;
  external_user_id: string | null;
  external_username: string | null;
  post_external_id: string | null;
  text: string | null;
  intent: Intent | null;
  intent_confidence: number | null;
  status: InteractionStatus;
  attempts: number;
};
