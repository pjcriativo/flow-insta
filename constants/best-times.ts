import { ChannelTypeEnum } from "./channels";

// Melhores horários para postar por rede social (heurística baseada em estudos
// públicos consolidados de engajamento). Dias: 0=domingo ... 6=sábado.
// Horas em formato 24h (horário local do usuário).
// Estes são pontos de PARTIDA — o endpoint /api/best-times ajusta com base no
// histórico real de publicação da organização quando houver dados.

export type BestTimeSlot = { day: number; hour: number };

export const BEST_TIMES: Record<ChannelTypeEnum, BestTimeSlot[]> = {
  [ChannelTypeEnum.INSTAGRAM]: [
    { day: 1, hour: 11 }, { day: 2, hour: 11 }, { day: 3, hour: 11 },
    { day: 2, hour: 19 }, { day: 4, hour: 19 }, { day: 5, hour: 13 },
  ],
  [ChannelTypeEnum.FACEBOOK]: [
    { day: 1, hour: 9 }, { day: 3, hour: 13 }, { day: 5, hour: 15 },
    { day: 2, hour: 10 }, { day: 4, hour: 10 },
  ],
  [ChannelTypeEnum.TWITTER]: [
    { day: 1, hour: 9 }, { day: 2, hour: 12 }, { day: 3, hour: 12 },
    { day: 4, hour: 17 }, { day: 5, hour: 9 },
  ],
  [ChannelTypeEnum.LINKEDIN]: [
    { day: 2, hour: 8 }, { day: 2, hour: 10 }, { day: 3, hour: 9 },
    { day: 4, hour: 8 }, { day: 4, hour: 10 },
  ],
  [ChannelTypeEnum.THREADS]: [
    { day: 1, hour: 10 }, { day: 3, hour: 12 }, { day: 5, hour: 19 },
    { day: 2, hour: 18 },
  ],
  [ChannelTypeEnum.BLUESKY]: [
    { day: 1, hour: 9 }, { day: 3, hour: 13 }, { day: 5, hour: 17 },
  ],
  [ChannelTypeEnum.TIKTOK]: [
    { day: 2, hour: 18 }, { day: 4, hour: 12 }, { day: 5, hour: 19 },
    { day: 6, hour: 11 },
  ],
  [ChannelTypeEnum.YOUTUBE]: [
    { day: 4, hour: 16 }, { day: 5, hour: 15 }, { day: 6, hour: 11 },
    { day: 0, hour: 10 },
  ],
};

export const WEEKDAY_LABELS = [
  "Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado",
];
export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
