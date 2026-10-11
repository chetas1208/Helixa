import json

import httpx
import pytest

from services.integrations.raindrop import RaindropAdapter, ToolEvent
from services.integrations.raindrop import adapter as raindrop_module

SEQ = "ACGTACGTACGTACGTACGTACGT"


def _install_transport(monkeypatch, handler):
    real_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(raindrop_module.httpx, "AsyncClient", factory)


def test_sanitize_scrubs_nucleotides_inside_tuples():
    adapter = RaindropAdapter(enabled=False)
    clean = adapter._sanitize({"alleles": (SEQ, "ok"), "nested": ({"note": SEQ},)})
    assert SEQ not in json.dumps(clean)
    assert "ok" in clean["alleles"]


def test_sanitize_scrubs_nucleotides_in_dict_keys():
    adapter = RaindropAdapter(enabled=False)
    clean = adapter._sanitize({"kmer_counts": {SEQ: 5, "benign": 1}})
    assert SEQ not in json.dumps(clean)
    assert clean["kmer_counts"]["benign"] == 1


@pytest.mark.asyncio
async def test_wire_payload_never_carries_sequence(monkeypatch):
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append({"auth": request.headers["authorization"], "body": json.loads(request.content)})
        return httpx.Response(202)

    _install_transport(monkeypatch, handler)
    adapter = RaindropAdapter(endpoint="https://rd.invalid/v1", write_key="wk", project_id="p", enabled=True)
    ok = await adapter.finish_run(
        "run-1",
        {"alleles": (SEQ,), "kmers": {SEQ: 1}, "api_key": "wk", "status": "PASS"},
    )
    assert ok is True
    assert len(seen) == 1
    wire = json.dumps(seen[0]["body"])
    assert SEQ not in wire
    event = seen[0]["body"][0]
    assert "wk" not in event["properties"].values()
    assert event["properties"]["status"] == "PASS"
    assert event["event"] == "run.finished"
    assert seen[0]["auth"] == "Bearer wk"
    assert SEQ not in json.dumps(adapter._mock_traces)


@pytest.mark.asyncio
async def test_not_configured_makes_no_network_call(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("network call while NOT_CONFIGURED")

    _install_transport(monkeypatch, handler)
    adapter = RaindropAdapter(enabled=True, write_key="")
    assert adapter.status == "NOT_CONFIGURED"
    assert await adapter.record_tool(ToolEvent(run_id="r", tool_name="t", runtime_ms=1.0, exit_code=0)) is False
    adapter = RaindropAdapter(enabled=False, write_key="k")
    assert adapter.status == "NOT_CONFIGURED"
    assert await adapter.finish_run("r", {}) is False


@pytest.mark.asyncio
async def test_transport_failure_and_http_error_are_non_fatal(monkeypatch):
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    _install_transport(monkeypatch, boom)
    adapter = RaindropAdapter(endpoint="https://rd.invalid/v1", write_key="k", enabled=True)
    assert await adapter.finish_run("r", {}) is False

    _install_transport(monkeypatch, lambda request: httpx.Response(500))
    assert await adapter.finish_run("r", {}) is False


def test_sanitize_drops_secret_keys_case_insensitively():
    adapter = RaindropAdapter(enabled=False)
    clean = adapter._sanitize({"Authorization": "Bearer x", "WRITE_KEY": "x", "Password": "x", "ok": "fine"})
    assert clean == {"ok": "fine"}
