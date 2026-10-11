"""Retrieval merge, filters, fallback, and local Mongo persistence."""

import uuid
from types import SimpleNamespace

import pytest

from services.integrations.mongodb import MongoDBClient
from services.integrations.voyage.types import RankedDocument
from services.runtime.research_evidence.benchmark import (
    HELDOUT_QUERIES,
    PUBLIC_QUERIES,
    run_queries,
)
from services.runtime.research_evidence.policy import (
    EVALUATOR_VERSION,
    evaluate_policy,
    judge_promotion,
    propose_retrieval_policy,
)
from services.runtime.research_evidence.tool import search_research_evidence
from services.runtime.retrieval.corpus import MISLEADING_DOCUMENTS
from services.runtime.retrieval.lexical import tokenize
from services.runtime.retrieval.pipeline import ResearchPipeline
from services.runtime.retrieval.store import ResearchStore


class OfflineModel:
    def __init__(self) -> None:
        self.config = SimpleNamespace(embedding_model="voyage-4-large", rerank_model="rerank-3")

    def health_state(self) -> str:
        return "not_configured"


def _vec(text: str, size: int = 8) -> list[float]:
    vector = [0.0] * size
    for token in tokenize(text):
        vector[hash(token) % size] += 1.0
    return vector


class HashModel:
    """Wiring stand-in. Not a Voyage quality claim."""

    def __init__(self) -> None:
        self.config = SimpleNamespace(embedding_model="hash-v1", rerank_model="hash-rerank")
        self.last_embedding_version = "hash-v1:float:8"
        self.calls = {"rerank": 0}

    def health_state(self) -> str:
        return "connected"

    async def embed_query(self, query: str) -> list[float]:
        return _vec(query)

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [_vec(text) for text in texts]

    async def rerank(self, query: str, documents: list[str], top_k: int) -> list[RankedDocument]:
        self.calls["rerank"] += 1
        from services.runtime.retrieval.lexical import score_text

        ranked = [
            RankedDocument(index=index, text=document, relevance_score=score_text(query, document))
            for index, document in enumerate(documents)
        ]
        ranked.sort(key=lambda item: item.relevance_score, reverse=True)
        return ranked[:top_k]


def seeded() -> ResearchStore:
    store = ResearchStore()
    store.seed_curated()
    return store


@pytest.mark.asyncio
async def test_lexical_fallback_exact_gene_and_filters():
    pipeline = ResearchPipeline(seeded(), OfflineModel())
    result = await pipeline.search(
        "selected gene",
        context={"gene_id": "ENSG00000012048", "task_type": "editor"},
        policy="exact_vector_rerank",
    )
    assert result["status"] == "lexical_fallback"
    assert result["fallback_reason"] == "not_configured"
    assert result["exact_matches"][0]["document_id"] == "doc-brca1"
    assert result["model"]["embedding"] is None
    assert "causation" in result["disclaimer"]
    lung = await pipeline.search("CFTR", context={"tissue": "lung"}, policy="exact_lexical")
    assert [item["document_id"] for item in lung["passages"]] == ["doc-cftr"]


@pytest.mark.asyncio
async def test_misleading_documents_stay_out_and_chunks_do_not_duplicate():
    store = seeded()
    for document in MISLEADING_DOCUMENTS:
        store.upsert_document(document)
    before = len(store.chunks)
    store.upsert_document(store.documents["doc-brca1"])
    assert len(store.chunks) == before
    pipeline = ResearchPipeline(store, OfflineModel())
    result = await pipeline.search(
        "DNA changes because the climate needs it to adapt",
        policy="exact_lexical",
    )
    ids = [item["document_id"] for item in result["passages"]]
    assert "doc-mislead-climate" not in ids
    assert "doc-mislead-eyes" not in ids
    assert "doc-wright-fisher" in ids


@pytest.mark.asyncio
async def test_vector_version_guard_and_rerank_policy():
    store = seeded()
    model = HashModel()
    vectors = await model.embed_documents([chunk["text"] for chunk in store.chunks.values()])
    for chunk, vector in zip(store.chunks.values(), vectors, strict=True):
        store.upsert_embedding(
            chunk["chunk_id"],
            vector=vector,
            model_name="hash-v1",
            embedding_version="hash-v1:float:8",
        )
    with pytest.raises(ValueError):
        store.upsert_embedding(
            next(iter(store.chunks)),
            vector=[0.0] * 8,
            model_name="voyage-3.5",
            embedding_version="voyage-3.5:float:1024",
        )
    pipeline = ResearchPipeline(store, model)
    hybrid = await pipeline.search("BRCA1 breast association", policy="exact_vector")
    assert hybrid["status"] == "hybrid"
    assert hybrid["index"]["mode"] == "local_cosine"
    assert hybrid["index"]["vector_search_active"] is False
    reranked = await pipeline.search("BRCA1 breast association", policy="exact_vector_rerank")
    assert reranked["status"] in {"hybrid_reranked", "lexical_reranked"}
    assert model.calls["rerank"] == 1
    assert reranked["model"]["rerank"] == "hash-rerank"


@pytest.mark.asyncio
async def test_tool_marks_text_untrusted_and_policy_cannot_replace_evaluator():
    pipeline = ResearchPipeline(seeded(), OfflineModel())
    tool = await search_research_evidence(pipeline, "TP53 tumor protein p53", top_k=3, policy="exact_lexical")
    assert tool["untrusted"] is True
    assert tool["citations"]
    assert all(item["untrusted"] for item in tool["citations"])
    with pytest.raises(PermissionError):
        propose_retrieval_policy("replace_evaluator")
    assert propose_retrieval_policy("exact_lexical") == "exact_lexical"
    heldout = await evaluate_policy(pipeline, "exact_lexical", HELDOUT_QUERIES)
    assert heldout["evaluator_version"] == EVALUATOR_VERSION
    assert heldout["contamination"] == 0
    regression = judge_promotion(heldout, {**heldout, "policy": "exact_vector", "mean_recall": 0.0})
    assert regression["regression"] is True
    assert regression["promoted"] is False
    store = pipeline.store
    store.record_policy_eval(regression)
    assert store.policy_evals[-1]["regression"] is True


@pytest.mark.asyncio
async def test_public_lexical_benchmark_has_full_recall_and_no_unsupported_claims():
    report = await run_queries(
        ResearchPipeline(seeded(), OfflineModel()), PUBLIC_QUERIES, policy="exact_lexical"
    )
    assert report["count"] == 8
    assert report["unsupported_claim_count"] == 0
    assert report["mean_citation_coverage"] == 1.0
    missed = [row["id"] for row in report["cases"] if row["recall_at_k"] < 1]
    assert missed == []


@pytest.mark.asyncio
async def test_local_mongo_idempotent_index_and_run_trace():
    client = MongoDBClient(db_name=f"diamond_v16_{uuid.uuid4().hex[:8]}")
    try:
        if not await client.ping():
            pytest.skip("local MongoDB is not reachable")
        store = seeded()
        store.db = client.db
        pipeline = ResearchPipeline(store, OfflineModel())
        await pipeline.search("BRCA1 association", context={"workspace_id": "ws-a"}, policy="exact_lexical")
        await store.ensure_indexes()
        first = await store.flush_mongo()
        second = await store.flush_mongo()
        assert first["documents"] == second["documents"]
        assert await client.db.research_documents.count_documents({}) == len(store.documents)
        assert await client.db.research_chunks.count_documents({}) == len(store.chunks)
        runs = await client.db.retrieval_runs.count_documents({})
        assert runs == 1
        stored = await client.db.research_documents.find_one({"document_id": "doc-brca1"}, {"_id": 0})
        assert stored is not None
        assert "ENSG00000012048" in stored["gene_ids"]
        assert "ACGTACGTACGT" not in stored["excerpt"]
    finally:
        await client.client.drop_database(client.db_name)
        await client.close()
