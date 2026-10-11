import pytest

from services.integrations.elevenlabs import BriefingRequest, ElevenLabsAdapter
from services.integrations.raindrop import (
    RaindropAdapter,
    RunMetadata,
)


@pytest.mark.asyncio
async def test_raindrop_not_configured_by_default():
    adapter = RaindropAdapter(enabled=False, write_key="")
    assert adapter.status == "NOT_CONFIGURED"

    # Calls still succeed locally and record mock traces without crashing
    ok = await adapter.start_run(
        RunMetadata(
            run_id="run-1",
            task_id="task-1",
            dataset_id="ds-1",
            harness_version="harness-v1",
            started_at="2026-10-11T06:00:00Z",
        )
    )
    assert ok is False
    assert len(adapter._mock_traces) == 1

@pytest.mark.asyncio
async def test_raindrop_privacy_sanitization():
    adapter = RaindropAdapter(enabled=False)
    dirty_payload = {
        "run_id": "run-test",
        "tool": "validator",
        "sequence": "ACTGACTGACTG",
        "vcf_content": "##fileformat=VCF...",
        "status": "FAIL",
    }
    clean = adapter._sanitize(dirty_payload)
    assert "run_id" in clean
    assert "tool" in clean
    assert "status" in clean
    assert "sequence" not in clean
    assert "vcf_content" not in clean
    nested = adapter._sanitize(
        {
            "message": "header ATCGATCGATCGATCGATCG must not leave the host",
            "api_key": "rd_live_secret",
            "nested": {"note": "TTTTTTTTTTTTTTTT"},
        }
    )
    assert "ATCGATCGATCGATCGATCG" not in str(nested)
    assert "[redacted-nucleotide]" in nested["message"]
    assert "api_key" not in nested
    assert "[redacted-nucleotide]" in nested["nested"]["note"]

@pytest.mark.asyncio
async def test_elevenlabs_not_configured_and_script_composition():
    adapter = ElevenLabsAdapter(enabled=False, api_key="")
    assert adapter.status == "NOT_CONFIGURED"

    req = BriefingRequest(
        receipt_id="receipt-123",
        run_id="run-456",
        candidate_version_id="harness-v2-candidate",
        score="6/6",
        promoted=True,
        decision_reason="All checks passed.",
    )
    script = adapter.compose_briefing_script(req)
    assert "reference allele integrity incident" in script
    assert "harness-v2-candidate" in script
    assert "6/6" in script
    assert "receipt-123" in script
    # Assert zero nucleotide payloads in script
    assert "ACTG" not in script

@pytest.mark.asyncio
async def test_elevenlabs_streaming_mock_transport():
    adapter = ElevenLabsAdapter(enabled=True, api_key="mock-key")
    mock_bytes = [b"\xff\xfb\x90\x44", b"\x00\x00\x01\x02"]

    chunks = []
    async for chunk in adapter.stream_speech("test speech", mock_chunks=mock_bytes):
        chunks.append(chunk)

    assert len(chunks) == 2
    assert chunks[0] == mock_bytes[0]
