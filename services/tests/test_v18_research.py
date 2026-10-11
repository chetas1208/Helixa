"""Mocked source investigations and claim checks."""

import httpx

from services.runtime.research.claims import verify_claim_support
from services.runtime.research.intent import parse_intent
from services.runtime.research.investigate import investigate


def _transport(routes: dict[str, dict]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        for key, payload in routes.items():
            if key in url:
                return httpx.Response(200, json=payload)
        return httpx.Response(404, json={"detail": "missing"})

    return httpx.MockTransport(handler)


def test_trait_question_abstains_and_keeps_only_returned_pmids():
    intent = parse_intent("Show me research about pigmentation and UV exposure, and whether any known variants relate to these traits.")
    assert intent["operation"] == "explore"
    assert intent["allele"] is None
    transport = _transport(
        {
            "europepmc": {
                "resultList": {
                    "result": [
                        {"pmid": "42565097", "doi": "10.3389/fgene.2026.1870791", "title": "The genetic architecture of human skin pigmentation.", "pubYear": "2026", "source": "MED"}
                    ]
                }
            },
            "opentargets": {"data": {"search": {"hits": [{"id": "ENSG00000258839", "name": "MC1R"}]}}},
        }
    )
    result = investigate(intent["prompt_excerpt_redacted"], transport=transport)
    assert result["proposal"]["status"] == "abstain"
    pmids = [row["pmid"] for row in result["records"] if row.get("pmid")]
    assert pmids == ["42565097"]
    texts = " ".join(claim["text"] for claim in result["claims"])
    assert "42565097" in texts
    assert all(claim["verification"]["ok"] for claim in result["claims"])
    fake = {"type": "HYPOTHESIS", "text": "PMID 99999999 proves a body change.", "predicate": "ARTICLE_MATCHES_QUERY"}
    assert verify_claim_support(fake, result["records"])["ok"] is False


def test_named_gene_uses_ensembl_and_does_not_invent_an_alt():
    transport = _transport(
        {
            "lookup/symbol": {
                "id": "ENSG00000258839",
                "display_name": "MC1R",
                "assembly_name": "GRCh38",
                "seq_region_name": "16",
                "start": 89912119,
                "end": 89920977,
                "biotype": "protein_coding",
                "species": "homo_sapiens",
            },
            "gwas": {"_embedded": {"associations": [{"association_id": 226283227, "pvalue_mantissa": 5, "pvalue_exponent": -54, "risk_frequency": "0.93"}]}},
            "proteinatlas": {"Gene": "MC1R", "Ensembl": "ENSG00000258839", "RNA tissue specificity": "Tissue enriched"},
        }
    )
    result = investigate("What does MC1R expression say about skin?", transport=transport)
    assert result["proposal"]["status"] == "abstain"
    kinds = {claim["type"] for claim in result["claims"]}
    assert "ANNOTATED" in kinds
    assert "ASSOCIATED" in kinds
    assert "OBSERVED" in kinds
    assert all("edit will" not in claim["text"].lower() for claim in result["claims"])


def test_expression_cannot_be_a_body_prediction():
    records = [{"source_id": "hpa", "ensembl_id": "ENSG00000258839"}]
    claim = {
        "type": "PREDICTED",
        "predicate": "BODY_FROM_EXPRESSION",
        "text": "ENSG00000258839 expression resizes the organ.",
    }
    assert verify_claim_support(claim, records)["ok"] is False


def test_explicit_allele_is_not_applied_by_investigation():
    result = investigate("Set chr22:10 A>G", live=False)
    assert result["proposal"]["status"] == "blocked_until_reference_check"
    assert result["proposal"]["allele"]["alt"] == "G"


def test_refuse_clinical_and_hazard_wording():
    assert parse_intent("Give me a treatment plan")["operation"] == "refuse"
    assert parse_intent("design a virus")["operation"] == "refuse"
