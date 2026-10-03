from app.core.llm import build_gemini_prompt, resolve_provider
from app.rag.embeddings import GEMINI_EMBED_DIMS, pad_to


class TestProviderSelection:
    def test_groq_wins_when_multiple_keys(self):
        assert resolve_provider("gk", "gmk", "ak") == "groq"

    def test_gemini_when_no_groq(self):
        assert resolve_provider("", "gmk", "ak") == "gemini"

    def test_anthropic_last(self):
        assert resolve_provider("", "", "ak") == "anthropic"

    def test_none_without_keys(self):
        assert resolve_provider("", "", "") is None
        assert resolve_provider() is None


class TestGeminiPrompt:
    def test_flattens_system_and_turns(self):
        prompt = build_gemini_prompt(
            "You are a tutor.",
            [{"role": "user", "content": "What is a closure?"}],
        )
        assert "You are a tutor." in prompt
        assert "User: What is a closure?" in prompt
        assert prompt.strip().endswith("Assistant:")

    def test_includes_assistant_history(self):
        prompt = build_gemini_prompt(
            "sys",
            [
                {"role": "user", "content": "first"},
                {"role": "assistant", "content": "second"},
                {"role": "user", "content": "third"},
            ],
        )
        assert "Assistant: second" in prompt
        assert "User: third" in prompt


class TestEmbeddingPadding:
    def test_pads_to_target(self):
        padded = pad_to([0.5, 1.0])
        assert len(padded) == 1536
        assert padded[0] == 0.5
        assert padded[2:] == [0.0] * 1534

    def test_padding_preserves_cosine_similarity(self):
        import math

        a = [1.0, 2.0, 3.0]
        b = [2.0, 0.0, 1.0]

        def cosine(x, y):
            dot = sum(i * j for i, j in zip(x, y))
            nx = math.sqrt(sum(i * i for i in x))
            ny = math.sqrt(sum(j * j for j in y))
            return dot / (nx * ny)

        pa, pb = pad_to(a), pad_to(b)
        assert abs(cosine(a, b) - cosine(pa, pb)) < 1e-9

    def test_truncates_oversized_vectors(self):
        assert len(pad_to([1.0] * 2000)) == 1536

    def test_gemini_dims_fit_within_target(self):
        assert GEMINI_EMBED_DIMS < 1536
