"""Chunking strategies for transcript ingestion (Phase 3)."""


def chunk_transcript(text: str, max_chars: int = 1200, overlap: int = 150) -> list[str]:
    """Split a lecture transcript into overlapping chunks sized for embedding.

    Phase 3 wires the output of this into embed() -> document_chunks.
    """
    if not text:
        return []
    words = text.split()
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for word in words:
        current.append(word)
        current_len += len(word) + 1
        if current_len >= max_chars:
            chunks.append(" ".join(current))
            # carry `overlap` characters into the next chunk for context continuity
            overlap_words: list[str] = []
            overlap_len = 0
            for w in reversed(current):
                overlap_len += len(w) + 1
                if overlap_len > overlap:
                    break
                overlap_words.insert(0, w)
            current = overlap_words
            current_len = overlap_len

    if current:
        chunks.append(" ".join(current))
    return chunks
