-- Storage bucket for post/idea images (Supabase Storage).
-- Run this in the Supabase SQL Editor, or create the bucket manually in the
-- dashboard (Storage -> New bucket -> name "flow-insta", Public).

insert into storage.buckets (id, name, public)
values ('flow-insta', 'flow-insta', true)
on conflict (id) do nothing;

-- Allow public read of objects in the bucket (images are served via public URL).
drop policy if exists "flow_insta_public_read" on storage.objects;
create policy "flow_insta_public_read" on storage.objects
  for select
  to public
  using (bucket_id = 'flow-insta');

-- Uploads are performed server-side with the service role key, which bypasses
-- RLS, so no insert policy is required for the app's upload route. Add one only
-- if you decide to upload directly from the client with the anon key.
