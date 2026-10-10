"""LLM client with pluggable providers.

Priority: Groq → Gemini → Anthropic. Whichever API key is set wins;
`resolve_provider` is pure so the selection logic stays unit-testable.

Two provider quirks are absorbed here rather than leaking into the routers:

* Groq's reasoning models (``gpt-oss-*``) bill hidden "thinking" tokens
  against ``max_tokens`` and may return an empty ``content`` with a populated
  ``reasoning`` field. We pin ``reasoning_effort: "low"`` and read whichever
  field carries text.
* Gemini 2.5+/3.x does the same via ``thoughtsTokenCount``. Thinking is
  disabled for tutoring (latency is a stated KPI) and any ``thought`` parts
  are dropped from the assembled answer.
"""

from typing import Optional

import httpx

from .config import get_settings

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class LLMError(RuntimeError):
    """Raised when a provider call fails — callers fall back to offline mode."""


def resolve_provider(
    groq_key: str = "", gemini_key: str = "", anthropic_key: str = ""
) -> Optional[str]:
    """Pick the LLM provider: Groq first, then Gemini, then Anthropic."""
    if groq_key:
        return "groq"
    if gemini_key:
        return "gemini"
    if anthropic_key:
        return "anthropic"
    return None


def get_provider() -> Optional[str]:
    s = get_settings()
    return resolve_provider(s.groq_api_key, s.gemini_api_key, s.anthropic_api_key)


# --- Groq -------------------------------------------------------------------


def _uses_hidden_reasoning(model: str) -> bool:
    """True for models that spend part of the output budget on hidden thinking."""
    return "gpt-oss" in model.lower()


def _groq_message_text(message: dict) -> str:
    """Prefer the visible answer, fall back to reasoning so we never return ""."""
    content = (message.get("content") or "").strip()
    if content:
        return content
    return (message.get("reasoning") or "").strip()


def _call_groq(system: str, messages: list[dict], max_tokens: int) -> str:
    s = get_settings()
    payload = {
        "model": s.groq_model,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            *[
                {"role": m.get("role", "user"), "content": m.get("content", "")}
                for m in messages
            ],
        ],
    }
    if _uses_hidden_reasoning(s.groq_model):
        # Reasoning tokens are drawn from max_tokens, so a "medium"/"high"
        # effort can truncate the visible answer on small budgets.
        payload["reasoning_effort"] = "low"
    try:
        resp = httpx.post(
            GROQ_URL,
            json=payload,
            headers={"Authorization": f"Bearer {s.groq_api_key}"},
            timeout=45,
        )
        resp.raise_for_status()
        text = _groq_message_text(resp.json()["choices"][0]["message"])
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise LLMError(f"Groq call failed: {exc}") from exc
    if not text:
        raise LLMError("Groq returned an empty completion")
    return text


# --- Gemini -----------------------------------------------------------------


def build_gemini_prompt(system: str, messages: list[dict]) -> str:
    """Flatten an OpenAI-style message list into a single grounded prompt."""
    turns = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
        for m in messages
    )
    return f"{system}\n\n{turns}\nAssistant:"


def _gemini_generation_config(model: str, max_tokens: int) -> dict:
    config: dict = {"maxOutputTokens": max_tokens, "temperature": 0.2}
    if model.startswith("gemini-2.5") or model.startswith("gemini-3"):
        # Without this, thinking can consume nearly the whole output budget —
        # a 200-token request was observed spending 189 tokens on thoughts.
        config["thinkingConfig"] = {
            "thinkingBudget": get_settings().gemini_thinking_budget
        }
    return config


def _gemini_candidate_text(candidate: dict) -> str:
    parts = candidate.get("content", {}).get("parts", [])
    return "".join(
        p.get("text", "") for p in parts if not p.get("thought")
    ).strip()


def _call_gemini(system: str, messages: list[dict], max_tokens: int) -> str:
    s = get_settings()
    url = GEMINI_URL.format(model=s.gemini_model)
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [
            {"role": "user", "parts": [{"text": build_gemini_prompt("", messages)}]}
        ],
        "generationConfig": _gemini_generation_config(s.gemini_model, max_tokens),
    }
    try:
        resp = httpx.post(url, json=payload, params={"key": s.gemini_api_key}, timeout=45)
        resp.raise_for_status()
        text = _gemini_candidate_text(resp.json()["candidates"][0])
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise LLMError(f"Gemini call failed: {exc}") from exc
    if not text:
        raise LLMError("Gemini returned an empty completion")
    return text


# --- Anthropic --------------------------------------------------------------


def _call_anthropic(system: str, messages: list[dict], max_tokens: int) -> str:
    s = get_settings()
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=s.anthropic_api_key)
        response = client.messages.create(
            model=s.anthropic_model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        )
        return "".join(block.text for block in response.content if block.type == "text")
    except Exception as exc:  # provider SDK errors vary
        raise LLMError(f"Anthropic call failed: {exc}") from exc


def complete(system: str, messages: list[dict], max_tokens: int = 1024) -> str:
    """Single-turn completion with the configured provider.

    Raises LLMError on failure so callers can fall back to offline mode.
    """
    provider = get_provider()
    if provider is None:
        # Graceful degradation keeps the platform demoable without any key.
        return (
            "[AI tutor is not configured] Set GROQ_API_KEY or GEMINI_API_KEY to enable "
            "LLM answers. Your question was: "
            + (messages[-1].get("content", "") if messages else "")
        )
    if provider == "groq":
        return _call_groq(system, messages, max_tokens)
    if provider == "gemini":
        return _call_gemini(system, messages, max_tokens)
    return _call_anthropic(system, messages, max_tokens)
