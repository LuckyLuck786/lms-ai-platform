from app.core.llm import (
    _gemini_candidate_text,
    _gemini_generation_config,
    _groq_message_text,
    _uses_hidden_reasoning,
    build_gemini_prompt,
    resolve_provider,
)
from app.rag.embeddings import GEMINI_EMBED_DIMS, _supports_output_dimensionality, pad_to


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

    def test_gemini_dims_match_the_column(self):
        assert GEMINI_EMBED_DIMS == 1536


def test_output_dimensionality_only_for_mrl_models():
    assert _supports_output_dimensionality("gemini-embedding-001")
    assert not _supports_output_dimensionality("text-embedding-004")


class TestReasoningModels:
    """gpt-oss / Gemini 2.5 hide reasoning tokens inside the output budget."""

    def test_detects_groq_reasoning_models(self):
        assert _uses_hidden_reasoning("openai/gpt-oss-120b")
        assert _uses_hidden_reasoning("openai/gpt-oss-20b")
        assert not _uses_hidden_reasoning("qwen/qwen3.8-27b")

    def test_groq_prefers_content_over_reasoning(self):
        assert _groq_message_text({"content": "answer", "reasoning": "hmm"}) == "answer"

    def test_groq_falls_back_to_reasoning_when_content_empty(self):
        assert _groq_message_text({"content": "", "reasoning": "thought"}) == "thought"
        assert _groq_message_text({}) == ""

    def test_gemini_disables_thinking_budget_for_25(self):
        config = _gemini_generation_config("gemini-2.5-flash", 700)
        assert config["thinkingConfig"] == {"thinkingBudget": 0}
        assert config["maxOutputTokens"] == 700

    def test_gemini_leaves_older_models_alone(self):
        assert "thinkingConfig" not in _gemini_generation_config("gemini-1.5-flash", 700)

    def test_gemini_drops_thought_parts(self):
        candidate = {
            "content": {
                "parts": [
                    {"text": "internal musing", "thought": True},
                    {"text": "The visible answer"},
                ]
            }
        }
        assert _gemini_candidate_text(candidate) == "The visible answer"
