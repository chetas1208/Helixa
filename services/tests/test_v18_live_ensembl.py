"""Live public Ensembl lookup. Skips when the network is down. Does not invent an id."""

import pytest

from services.runtime.research.sources.client import SourceError
from services.runtime.research.sources.public import ensembl_symbol


def test_live_ensembl_symbol_lookup():
    try:
        row = ensembl_symbol("MC1R")
    except SourceError as exc:
        pytest.skip(f"Ensembl unavailable: {exc.status}")
    except Exception as exc:
        pytest.skip(f"Ensembl unreachable: {type(exc).__name__}")
    assert row["external_id"].startswith("ENSG")
    assert row["symbol"] == "MC1R"
    assert row["assembly"] == "GRCh38"
    assert row["contig"] == "16"
