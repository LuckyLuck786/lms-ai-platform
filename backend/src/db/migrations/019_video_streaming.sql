-- 019_video_streaming.sql — adaptive HLS delivery through Cloud CDN (PRD §9.4, §13)
--
-- hls_status: NULL (never processed) → processing → ready | failed.
-- hls_job holds the Transcoder API job name while it runs.
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS hls_url TEXT;
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS hls_status VARCHAR(20)
  CHECK (hls_status IN ('processing', 'ready', 'failed'));
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS hls_job TEXT;
