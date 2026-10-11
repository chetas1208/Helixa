# Audit: int_raindrop (services/integrations/raindrop/*)

## FIXED
1. services/integrations/raindrop/adapter.py `_scrub_value` (tuple branch missing, ~line 98): nucleotide scrubbing recursed only into str/dict/list, so a long nucleotide string inside a tuple value passed through `_sanitize` untouched and was serialized to the wire (JSON array) and into `_mock_traces`. Violates ADR-013 (zero genomic data leakage).
   - Failing tests: `test_sanitize_scrubs_nucleotides_inside_tuples`, `test_wire_payload_never_carries_sequence` (services/tests/test_audit_int_raindrop.py).
   - Fix: added a `tuple` branch that scrubs each element and preserves the tuple type.
2. services/integrations/raindrop/adapter.py `_sanitize` (dict keys, ~line 87): dict keys were never scrubbed, so a nested mapping keyed by a sequence (for example k-mer counts) leaked the sequence verbatim.
   - Failing tests: `test_sanitize_scrubs_nucleotides_in_dict_keys`, `test_wire_payload_never_carries_sequence`.
   - Fix: entries whose key contains a 16+ nucleotide run are pruned (ADR-013 allows prune); avoids key collisions that replacing with a marker would cause.

## UNVERIFIED/NEEDS OTHER OWNER
- adapter.py:`_dispatch` `self._mock_traces.append(record)` is unbounded and also runs when enabled; a long-lived adapter grows without limit. Adapters are currently created per request, and tests read `_mock_traces`, so left unchanged.
- adapter.py:`__init__` uses `write_key or os.getenv(...)`, so an explicit `write_key=""` falls back to the env key (same for endpoint/project_id). With `enabled=True` plus env key set, an explicit empty key would still be CONFIGURED. Intent is ambiguous; no current caller does this (experiment.py passes `enabled=False`).
- adapter.py:`_sanitize` calls `key.lower()`, so a non-str key in a `finish_run` summary raises AttributeError (not covered by the non-fatal handling). The signature types summary as `dict[str, Any]`, so not changed.
- adapter.py:13 `_NUCLEOTIDE_RUN` only matches `[ACGTNacgtn]{16,}`: RNA (`U`), IUPAC ambiguity codes, or sequences broken by separators/spaces are not detected. This is a heuristic bound, not a provable defect; widening risks false positives.
- adapter.py:`_dispatch` treats only 200/201/202 as success (204 reports False); builds `f"{endpoint}/events"` so a trailing-slash endpoint yields `//events`. Vendor contract unknown.
- adapter.py:`_DISALLOWED_KEYS` substring match over-redacts benign keys (for example `tokens_used`, `content_type`). Fails safe (privacy direction), left as is.

## VERIFIED OK
- `status`: NOT_CONFIGURED unless enabled and a write key is present (ADR-018); no network call is made in that state (test_not_configured_makes_no_network_call).
- Secret/sequence key dropping is case-insensitive and recursive through dicts and lists; Authorization header is sent only in the request header, never in payload or logs.
- Dispatch failures (transport error, HTTP 500) return False and are logged without secrets; CancelledError is not swallowed (`except Exception`).
- httpx redirects not followed by default, 4s timeout, mock transport used in tests (no network).
- No clinical claims; package `__init__.py` exports match adapter definitions.
