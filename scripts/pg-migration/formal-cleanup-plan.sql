-- Read-only inventory. Run as migration owner with $1 set to the verified cloud:// prefix.
WITH queued AS (
  SELECT DISTINCT f.file_id FROM public.rehub_reports r CROSS JOIN LATERAL unnest(r.file_ids) AS f(file_id)
  WHERE r.type = 'image_cleanup' AND r.status = 'pending'
)
SELECT q.file_id, CASE
  WHEN $1::text IS NULL OR $1 !~ '^cloud://[A-Za-z0-9._-]+/$' OR NOT starts_with(q.file_id, $1)
    OR substring(q.file_id FROM length($1) + 1) !~ '^(images|avatars)/[A-Za-z0-9_-]+/[a-f0-9]{32}\.(jpg|png|webp)$'
    THEN 'legacy_or_unverified'
  WHEN EXISTS (SELECT 1 FROM public.rehub_users WHERE avatar = q.file_id)
    OR EXISTS (SELECT 1 FROM public.rehub_products WHERE status <> 'deleted' AND images @> ARRAY[q.file_id])
    OR EXISTS (SELECT 1 FROM public.rehub_orders WHERE product_image = q.file_id)
    OR EXISTS (SELECT 1 FROM public.rehub_conversations WHERE product_snapshot->>'image' = q.file_id)
    OR EXISTS (SELECT 1 FROM public.rehub_legacy_documents
      WHERE jsonb_path_exists(payload, '$.** ? (@ == $file)', jsonb_build_object('file', q.file_id))) THEN 'referenced'
  ELSE 'review_required' END AS disposition
FROM queued q WHERE q.file_id IS NOT NULL ORDER BY q.file_id;
