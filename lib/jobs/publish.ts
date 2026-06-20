import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { ImageObject, PostType } from "@/types/post.type";
import { decrypt, encrypt } from "@/lib/encryption";
import { refreshOauthToken } from "@/lib/social-oauth";
import { ChannelTypeEnum } from "@/constants/channels";
import { canPublish } from "@/lib/approvals/publish-gate";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;

/**
 * Publica UM post já reivindicado pelo tick (status 'publishing').
 * Runner puro extraído de inngest/functions/publish-scheduled-posts.ts.
 *
 * - Gate de aprovação: se aguardando aprovação, volta o post para 'queue'
 *   (re-tentável no próximo tick) e retorna skipped.
 * - Publica em Twitter/LinkedIn; refresh de token se expirado.
 * - Sucesso: markPostPublished. Erro: markPostFailed (status 'failed').
 */
export async function runPublishPost(postId: string) {
  const supabase = getSupabaseAdminClient();

  // Carrega o post reivindicado (status 'publishing').
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*, user_channels(*, channel_types(id, type, name))")
    .eq("id", postId)
    .eq("status", "publishing")
    .single();

  if (error || !data) {
    return { skipped: true, reason: "post_not_found_or_not_claimed" };
  }
  const post = data as PostType;

  // Gate de aprovação: se aguardando aprovação do cliente, devolve para 'queue'.
  const gate = await canPublish(post.id);
  if (!gate.allowed) {
    await revertToQueue(post.id);
    return { skipped: true, reason: "awaiting_approval" };
  }

  const userChannel = post.user_channels;
  if (!userChannel) {
    await markPostFailed(post.id, "Canal não encontrado");
    return { skipped: true, reason: "user_channel_not_found" };
  }
  const channelType = userChannel.channel_types;
  if (!channelType) {
    await markPostFailed(post.id, "Tipo de canal não encontrado");
    return { skipped: true, reason: "channel_type_not_found" };
  }

  const providerType = post.user_channels?.channel_types?.type;
  const accessToken = decrypt(post.user_channels?.access_token);
  const refreshToken = decrypt(post.user_channels?.refresh_token);
  const tokenExpiresAt = post.user_channels?.token_expires_at
    ? new Date(post.user_channels.token_expires_at).getTime()
    : null;
  const callbackUrl = `${APP_URL}/api/channel/callback`;
  const shouldRefreshBeforePublish =
    Boolean(refreshToken) && tokenExpiresAt !== null && tokenExpiresAt <= Date.now();

  if (!providerType || !accessToken) {
    await markPostFailed(post.id, "Provedor ou token ausente");
    return { skipped: true, reason: "missing_provider_or_token" };
  }

  let currentAccessToken = accessToken;

  if (shouldRefreshBeforePublish && refreshToken) {
    const result = await refreshOauthToken(
      providerType as ChannelTypeEnum,
      refreshToken,
      callbackUrl
    );
    await saveRefreshedToken(
      post.user_channels?.id,
      result.accessToken,
      result.refreshToken ?? refreshToken,
      result.expiresAt
    );
    currentAccessToken = result.accessToken;
  }

  try {
    let publishedUrl: string | null = null;
    if (providerType === ChannelTypeEnum.TWITTER) {
      publishedUrl = await publishToTwitter({
        accessToken: currentAccessToken,
        content: post.content,
        handle: post.user_channels?.handle,
        images: post.images,
      });
    } else if (providerType === ChannelTypeEnum.LINKEDIN) {
      publishedUrl = await publishToLinkedIn({
        accessToken: currentAccessToken,
        text: post.content,
        authorId: post.user_channels?.provider_account_id,
        images: post.images,
      });
    } else {
      throw new Error(`Unsupported provider type: ${providerType}`);
    }

    await markPostPublished(post.id, publishedUrl);
    return { published: true, provider: providerType };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await markPostFailed(post.id, message);
    return { published: false, error: message };
  }
}

// ---- Helpers de status ----

async function revertToQueue(postId: string) {
  const supabase = getSupabaseAdminClient();
  await supabase.from("scheduled_posts").update({ status: "queue" }).eq("id", postId);
}

async function markPostPublished(postId: string, published_url: string | null) {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_url,
    })
    .eq("id", postId);
  if (error) throw error;
}

async function markPostFailed(postId: string, errorMessage: string) {
  const supabase = getSupabaseAdminClient();
  await supabase
    .from("scheduled_posts")
    .update({ status: "failed", error_message: errorMessage })
    .eq("id", postId);
}

async function saveRefreshedToken(
  userChannelId: string | undefined,
  accessToken: string,
  refreshToken: string,
  expiresAt: number
) {
  if (!userChannelId) throw new Error("User channel ID is missing");
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("user_channels")
    .update({
      access_token: encrypt(accessToken),
      refresh_token: encrypt(refreshToken),
      token_expires_at: expiresAt ?? null,
    })
    .eq("id", userChannelId);
  if (error) throw error;
}

// ---- Publicação Twitter / LinkedIn (extraído de publish-scheduled-posts.ts) ----

async function publishToTwitter({
  accessToken,
  content,
  handle,
  images,
}: {
  accessToken: string;
  content: string;
  handle?: string | null;
  images?: ImageObject[];
}) {
  const mediaIds = images?.length ? await uploadImagesToTwitter({ accessToken, images }) : [];

  const response = await fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: content,
      ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
    }),
  });

  if (!response.ok) throw new Error("Failed to publish to Twitter");

  const responseText = await response.text();
  let data: { data?: { id?: string } } | null = null;
  try {
    data = JSON.parse(responseText);
  } catch {
    console.error("[publish] Failed to parse Twitter response", responseText);
    data = null;
  }

  const postId = data?.data?.id;
  if (!postId) throw new Error("Failed to get post ID from Twitter response");
  return handle ? `https://x.com/${handle}/status/${postId}` : null;
}

async function uploadImagesToTwitter({
  accessToken,
  images,
}: {
  accessToken: string;
  images: ImageObject[];
}) {
  const mediaIds: string[] = [];

  for (const image of images) {
    const fileResponse = await fetch(image.url);
    if (!fileResponse.ok) throw new Error("Failed to fetch image");

    const bytes = await fileResponse.arrayBuffer();
    const contentType = fileResponse.headers.get("content-type")?.split(";")[0].trim();
    const pathname = new URL(image.url).pathname.toLowerCase();

    const mediaType =
      contentType &&
      contentType != "binary/octet-stream" &&
      contentType != "application/octet-stream"
        ? contentType
        : pathname.endsWith(".png")
          ? "image/png"
          : pathname.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";

    const formData = new FormData();
    const blob = new Blob([bytes], { type: mediaType });
    formData.append("media", blob);
    formData.append("media_category", "tweet_image");
    formData.append("media_type", mediaType);

    const uploadRes = await fetch("https://api.x.com/2/media/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: formData,
    });

    const responseText = await uploadRes.text();
    let data: { data?: { id?: string; media_key?: string } } | null = null;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("[publish] Failed to parse Twitter media upload response", responseText);
      data = null;
    }

    if (!uploadRes.ok) throw new Error(`Failed to upload media to Twitter: ${responseText}`);

    const mediaId = data?.data?.id || data?.data?.media_key;
    if (!mediaId) throw new Error("Failed to get media ID from Twitter response");
    mediaIds.push(mediaId);
  }
  return mediaIds;
}

async function publishToLinkedIn({
  accessToken,
  text,
  authorId,
  images,
}: {
  accessToken: string;
  text: string;
  authorId?: string | null;
  images?: { url: string; key: string }[];
}) {
  if (!authorId) throw new Error("Missing LinkedIn provider account id.");
  const imageUrn = images?.[0]?.url
    ? await uploadLinkedInImage({ accessToken, authorId, imageUrl: images[0].url })
    : null;
  const body: Record<string, unknown> = {
    author: `urn:li:person:${authorId}`,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (imageUrn) {
    body.content = { media: { id: imageUrn } };
  }
  const response = await fetch("https://api.linkedin.com/rest/posts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": "202604",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let data: { message?: string; id?: string } | null = null;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    console.error("[publish] Failed to parse LinkedIn response", responseText);
  }

  if (!response.ok) {
    throw new Error(data?.message || "Failed to publish to LinkedIn.");
  }
  const restliId = response.headers.get("x-restli-id") || data?.id || null;
  return restliId
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(restliId)}`
    : null;
}

async function uploadLinkedInImage({
  accessToken,
  authorId,
  imageUrl,
}: {
  accessToken: string;
  authorId: string;
  imageUrl: string;
}) {
  const initResponse = await fetch(
    "https://api.linkedin.com/rest/images?action=initializeUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
        "Linkedin-Version": "202604",
      },
      body: JSON.stringify({
        initializeUploadRequest: { owner: `urn:li:person:${authorId}` },
      }),
    }
  );
  const initResponseText = await initResponse.text();
  let initData: { message?: string; value?: { uploadUrl?: string; image?: string } } | null = null;
  try {
    initData = initResponseText ? JSON.parse(initResponseText) : null;
  } catch {
    throw new Error("Failed to parse LinkedIn image initialization response.");
  }

  if (!initResponse.ok) {
    throw new Error(initData?.message || "Failed to initialize LinkedIn image upload.");
  }
  const uploadUrl = initData?.value?.uploadUrl;
  const imageUrn = initData?.value?.image;
  if (!uploadUrl || !imageUrn) {
    throw new Error("LinkedIn image upload initialization did not return an upload URL.");
  }
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error("Failed to fetch image for LinkedIn upload.");

  const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
  const imageBuffer = await imageResponse.arrayBuffer();
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: imageBuffer,
  });
  if (!uploadResponse.ok) throw new Error("Failed to upload image to LinkedIn.");

  return imageUrn as string;
}
