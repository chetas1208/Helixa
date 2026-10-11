# test_infra audit

Owned files: `pyproject.toml` `[tool.pytest.ini_options]` and the Makefile test targets.

## FIXED

- `Makefile` `.PHONY` line had `verifyverify-m01` (the space was missing), so `verify` was not declared phony. Restored `verify verify-m01`.
- `audit-backend` was already present and runs `.venv/bin/pytest -q services/tests` then `.venv/bin/ruff check services`. It was not given a second copy.

## UNVERIFIED/NEEDS OTHER OWNER

- One Starlette deprecation warning remains: `fastapi.testclient` imports `starlette.testclient`, which warns that `httpx` should be replaced by `httpx2`. No test failed. Not changed; it is a dependency warning, not an order bug.
- One skip appeared at the same point in every pass. It was stable, not a new failure.

## VERIFIED OK

Commands on 2026-10-11, database `diamond_audit_test_infra` (not `diamond_genome`):

| Pass | Result |
|---|---|
| 1 | 559 passed, 1 skipped, 0 failed |
| 2 | 559 passed, 1 skipped, 0 failed |
| 3 | 559 passed, 1 skipped, 0 failed |

`pytest --collect-only` collected 560 tests. `.venv/bin/ruff check services` passed. No order-dependent failure showed up across the three runs. `pyproject.toml` already sets `asyncio-mode=auto`, `testpaths`, and `pythonpath`, so no extra `pytest.ini` was added.
