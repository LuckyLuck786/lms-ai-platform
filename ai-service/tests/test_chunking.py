from app.rag.chunking import chunk_transcript
from app.rag.prompt import build_context_blocks, build_system_prompt, fallback_reply


class TestChunking:
    def test_empty_text(self):
        assert chunk_transcript("") == []

    def test_short_text_single_chunk(self):
        chunks = chunk_transcript("Hello world, this is a short transcript.")
        assert len(chunks) == 1
        assert "Hello world" in chunks[0]

    def test_long_text_produces_overlapping_chunks(self):
        text = " ".join(f"word{i}" for i in range(2000))
        chunks = chunk_transcript(text, max_chars=500, overlap=100)
        assert len(chunks) > 3
        # Chunks respect the size budget (plus last partial)
        assert all(len(c) <= 700 for c in chunks)
        # Overlap: the tail of chunk n appears at the start of chunk n+1
        tail = chunks[0][-50:]
        assert tail.split()[0] in chunks[1]


class TestPrompt:
    def test_system_prompt_contains_course_and_context(self):
        chunks = [{"lecture_title": "Quicksort", "chunk_text": "pivot selection..."}]
        prompt = build_system_prompt("DSA", "beginner", build_context_blocks(chunks))
        assert "DSA" in prompt
        assert "Quicksort" in prompt
        assert "pivot selection" in prompt
        assert "plain" in prompt  # beginner depth instruction

    def test_mode_switch_changes_depth(self):
        base = build_context_blocks([])
        adv = build_system_prompt("X", "advanced", base)
        beg = build_system_prompt("X", "beginner", base)
        assert adv != beg

    def test_fallback_reply_uses_best_chunk(self):
        reply = fallback_reply(
            [{"lecture_title": "Mergesort", "chunk_text": "Divide and conquer..."}]
        )
        assert "Mergesort" in reply
        assert "Divide and conquer" in reply

    def test_fallback_reply_without_material(self):
        assert "no ingested material" in fallback_reply([])
