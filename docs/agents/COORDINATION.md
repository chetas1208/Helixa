# Coordination

Execution mode: sequential. Five parallel workers were not started.

The population engine stayed in `services/runtime/population`. `services/runtime/evolution` was not edited.

V13 added routes on the existing `/api/v10` store and a not-configured transcribe route. Tests are `services/tests/test_v13_contract.py`. `make verify-v13` is the gate.
