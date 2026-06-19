// =========================================================
// Tipos do recurso "Atomização" (YouTube -> Reels/Carrossel/Story)
// =========================================================

export type JobStatus =
  | "queued"
  | "fetching"
  | "transcribing"
  | "selecting"
  | "rendering"
  | "generating"
  | "scheduling"
  | "completed"
  | "failed"
  | "canceled";

export type TranscriptSource = "native" | "whisper";

export type ClipStatus =
  | "selected"
  | "rendering"
  | "rendered"
  | "render_failed"
  | "discarded";

export type AssetType = "reel_caption" | "carousel" | "story" | "hashtags";

// Configurações do job (JSONB `settings`).
export type JobSettings = {
  clip_count?: number; // alvo de clips a selecionar
  auto_schedule?: boolean; // default false — nada agenda sem isso
};

// --- Linhas do banco (subconjuntos usados na UI/worker) ---

export type AtomizationJob = {
  id: string;
  organization_id: string;
  created_by: string;
  source_url: string;
  youtube_video_id: string | null;
  title: string | null;
  channel_title: string | null;
  duration_seconds: number | null;
  language: string | null;
  rights_attested: boolean;
  status: JobStatus;
  transcript_source: TranscriptSource | null;
  clip_count: number;
  settings: JobSettings;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type AtomizationClip = {
  id: string;
  job_id: string;
  organization_id: string;
  clip_index: number;
  start_seconds: number;
  end_seconds: number;
  hook_text: string | null;
  rationale: string | null;
  virality_score: number | null;
  status: ClipStatus;
  video_asset_path: string | null;
  thumbnail_path: string | null;
  render_idempotency_key: string | null;
  created_at: string;
  updated_at: string;
};

export type AtomizationAsset = {
  id: string;
  clip_id: string;
  organization_id: string;
  asset_type: AssetType;
  payload: Record<string, unknown>;
  post_id: string | null;
  created_at: string;
};

// Metadados de vídeo do YouTube (lib/atomization/youtube.ts).
export type YouTubeMeta = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  durationSeconds: number | null;
  available: boolean; // existe e é público
};

// Resultado do render (porta VideoRenderer).
export type RenderResult = {
  videoAssetPath: string;
  thumbnailPath: string | null;
};
