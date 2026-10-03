"""LLM client with pluggable providers.

Priority: Groq (free, fast llama-3.3-70b) → Gemini (flash) → Anthropic.
Whichever API key is configured wins; `resolve_provider` is pure so the
selection logic is unit-testable.
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


def _call_groq(system: str, messages: list[dict], max_tokens: int) -> str:
    s = get_settings()
    payload = {
        "model": s.groq_model,
        "max_tokens": max_tokens,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": system},
            *[{"role": m.get("role", "user"), "content": m.get("content", "")} for m in messages],
        ],
    }
    try:
        resp = httpx.post(
            GROQ_URL,
            json=payload,
            headers={"Authorization": f"Bearer {s.groq_api_key}"},
            timeout=45,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise LLMError(f"Groq call failed: {exc}") from exc


def build_gemini_prompt(system: str, messages: list[dict]) -> str:
    """Flatten an OpenAI-style message list into a single grounded prompt."""
    turns = "\n".join(
        f"{'User' if m.get('role') == 'user' else 'Assistant'}: {m.get('content', '')}"
        for m in messages
    )
    return f"{system}\n\n{turns}\nAssistant:"


def _call_gemini(system: str, messages: list[dict], max_tokens: int) -> str:
    s = get_settings()
    url = GEMINI_URL.format(model=s.gemini_model)
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": build_gemini_prompt("", messages)}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.2},
    }
    try:
        resp = httpx.post(url, json=payload, params={"key": s.gemini_api_key}, timeout=45)
        resp.raise_for_status()
        parts = resp.json()["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts)
    except (httpx.HTTPError, KeyError, IndexError) as exc:
        raise LLMError(f"Gemini call failed: {exc}") from exc


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
