import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { publishScheduledPost, publishScheduledPostsCron } from "@/inngest/functions/publish-scheduled-posts";
import { notifyApprovalDecision } from "@/inngest/functions/approvals/notify";
import { atomizationIngest } from "@/inngest/functions/atomization/ingest";
import { atomizationSelectClips } from "@/inngest/functions/atomization/select-clips";
import { atomizationRenderOrchestrate, atomizationRenderClip } from "@/inngest/functions/atomization/render-clip";
import { atomizationGenerateAssets } from "@/inngest/functions/atomization/generate-assets";
import { atomizationScheduleWeek } from "@/inngest/functions/atomization/schedule-week";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    publishScheduledPostsCron,
    publishScheduledPost,
    notifyApprovalDecision,
    atomizationIngest,
    atomizationSelectClips,
    atomizationRenderOrchestrate,
    atomizationRenderClip,
    atomizationGenerateAssets,
    atomizationScheduleWeek,
  ],
});