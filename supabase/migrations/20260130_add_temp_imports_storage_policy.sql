-- Add storage policy to allow authenticated users to upload to temp-imports folder
-- This is needed for client-side uploads to bypass Vercel's 4.5MB body size limit

-- Policy for uploading to temp-imports (INSERT)
CREATE POLICY "Users can upload to their own temp-imports folder"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'octree' AND
  (storage.foldername(name))[1] = 'temp-imports' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy for reading from temp-imports (SELECT) - needed for the API to download
CREATE POLICY "Users can read their own temp-imports files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'octree' AND
  (storage.foldername(name))[1] = 'temp-imports' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Policy for deleting temp-imports (DELETE) - needed for cleanup
CREATE POLICY "Users can delete their own temp-imports files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'octree' AND
  (storage.foldername(name))[1] = 'temp-imports' AND
  (storage.foldername(name))[2] = auth.uid()::text
);
