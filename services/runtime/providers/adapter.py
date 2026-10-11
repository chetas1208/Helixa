from __future__ import annotations

import os
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, Field


class Message(BaseModel):
    role: str
    content: str

class ToolDefinition(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]

class ModelResponse(BaseModel):
    content: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    provider_name: str
    is_fallback: bool = False

class ModelProvider(Protocol):
    async def generate(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        response_schema: type | None = None,
    ) -> ModelResponse: ...

class DeterministicProposer:
    """
    Real deterministic fallback proposing from a bounded library of failure-specific
    policy mutations. Never impersonates a remote model.
    """
    def __init__(self):
        self.provider_name = "deterministic-research-proposer"

    async def generate(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        response_schema: type | None = None,
    ) -> ModelResponse:
        # Inspect messages for diagnosis context
        prompt_text = " ".join(m.content for m in messages)
        if "reference_ref_allele_match" in prompt_text or "REF allele" in prompt_text:
            return ModelResponse(
                content="Diagnosed missing reference verification policy. Proposing activation of require_reference_allele_check and reference metadata inclusion.",
                tool_calls=[
                    {
                        "tool": "propose_mutation",
                        "arguments": {
                            "require_reference_allele_check": True,
                            "include_reference_metadata": True,
                            "mutation_reason": "Deterministic policy repair for REF allele mismatch gap",
                        },
                    }
                ],
                provider_name=self.provider_name,
                is_fallback=True,
            )
        return ModelResponse(
            content="No known deterministic policy gap identified in trace.",
            tool_calls=[],
            provider_name=self.provider_name,
            is_fallback=True,
        )

class OpenAICompatibleProvider:
    """
    OpenAI-compatible HTTP adapter for optional external LLMs.
    """
    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        model_name: str | None = None,
        timeout_seconds: float = 30.0,
    ):
        self.base_url = (base_url or os.getenv("MODEL_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key or os.getenv("MODEL_API_KEY", "")
        self.model_name = model_name or os.getenv("MODEL_NAME") or "gpt-4o-mini"
        self.timeout_seconds = timeout_seconds
        self.is_configured = bool(self.api_key and self.base_url)

    async def generate(
        self,
        messages: list[Message],
        tools: list[ToolDefinition] | None = None,
        response_schema: type | None = None,
    ) -> ModelResponse:
        if not self.is_configured:
            # Fall back to deterministic proposer
            return await DeterministicProposer().generate(messages, tools, response_schema)

        payload: dict[str, Any] = {
            "model": self.model_name,
            "messages": [m.model_dump() for m in messages],
        }
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            resp = await client.post(f"{self.base_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            choice = data["choices"][0]["message"]
            return ModelResponse(
                content=choice.get("content") or "",
                provider_name="openai-compatible",
                is_fallback=False,
            )


def build_model_provider() -> DeterministicProposer | OpenAICompatibleProvider:
    """Use the configured OpenAI-compatible model when a key is present."""
    provider = os.getenv("MODEL_PROVIDER", "deterministic")
    if provider == "openai-compatible" and os.getenv("MODEL_API_KEY"):
        timeout = float(os.getenv("MODEL_TIMEOUT_SECONDS", "60"))
        return OpenAICompatibleProvider(timeout_seconds=timeout)
    return DeterministicProposer()
