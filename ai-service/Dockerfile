# AI Tutor service — FastAPI + RAG pipelines
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# ffmpeg is required by the transcription job: an uploaded lecture video is
# routinely over the speech-to-text provider's ~25 MB upload cap, so an audio
# track is extracted first (app/routers/transcribe.py). Without it the route
# still works for small audio files and reports a clear reason for the rest.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000
# Cloud hosts inject $PORT; fall back to 8000 for local runs.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
