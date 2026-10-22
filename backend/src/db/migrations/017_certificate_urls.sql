-- 017_certificate_urls.sql — certificate_url held the generating container's
-- filesystem path (e.g. /app/uploads/certificates/<id>.pdf): unreachable from
-- any other instance, lost on redeploy, and it disclosed the server layout to
-- clients. PDFs are rendered on demand, so point every row at the download
-- route instead.
UPDATE certificates
SET certificate_url = '/api/v1/certificates/' || id || '/download'
WHERE certificate_url IS NOT NULL
  AND certificate_url NOT LIKE '/api/v1/certificates/%';
