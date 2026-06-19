import { getActiveOrg, getSupabaseUploadClient } from "@/lib/supabase-server";
import { authErrorResponse } from "@/lib/api-auth";
import { NextResponse } from "next/server";

// Supabase Storage bucket used for post/idea images. Create it (public) in
// the Supabase dashboard or via SQL.
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "flow-insta";

function sanitizeFileName(name: string) {
    return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function POST(request: Request) {
    try {
        const { orgId } = await getActiveOrg();
        const supabase = getSupabaseUploadClient();
        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!(file instanceof File)) {
            return NextResponse.json({ error: "No file provided" }, { status: 400 });
        }
        if (!file.type.startsWith("image/")) {
            return NextResponse.json({ error: "File must be an image" }, { status: 400 });
        }

        const key = `images/${orgId}/${Date.now()}-${sanitizeFileName(file.name)}`;
        const { data, error } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(key, file, {
                contentType: file.type,
                upsert: false,
            });

        if (error || !data) {
            return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
        }

        const { data: publicUrlData } = supabase.storage
            .from(STORAGE_BUCKET)
            .getPublicUrl(data.path);

        return NextResponse.json({
            image: {
                key: data.path,
                url: publicUrlData.publicUrl,
            },
        });

    } catch (error) {
        const authErr = authErrorResponse(error);
        if (authErr) return authErr;
        console.error("Error uploading image:", error);
        return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }
}
