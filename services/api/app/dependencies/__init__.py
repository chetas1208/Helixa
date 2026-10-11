from __future__ import annotations

from fastapi import Request

from services.integrations.mongodb import (
    ArtifactRepository,
    CheckpointRepository,
    DatasetRepository,
    EvaluationRepository,
    EventRepository,
    EvidenceRepository,
    HarnessRepository,
    IntegrationEventRepository,
    MemoryRepository,
    MongoDBClient,
    RunRepository,
    TaskRepository,
)


def get_mongo_client(request: Request) -> MongoDBClient:
    """Retrieve lifespan-managed MongoDBClient from app state, with fallback."""
    if hasattr(request.app.state, "mongo") and request.app.state.mongo is not None:
        return request.app.state.mongo
    return MongoDBClient()

def get_dataset_repo(request: Request) -> DatasetRepository:
    client = get_mongo_client(request)
    return DatasetRepository(mongo=client)

def get_artifact_repo(request: Request) -> ArtifactRepository:
    client = get_mongo_client(request)
    return ArtifactRepository(mongo=client)

def get_task_repo(request: Request) -> TaskRepository:
    client = get_mongo_client(request)
    return TaskRepository(mongo=client)

def get_run_repo(request: Request) -> RunRepository:
    client = get_mongo_client(request)
    return RunRepository(mongo=client)

def get_event_repo(request: Request) -> EventRepository:
    client = get_mongo_client(request)
    return EventRepository(mongo=client)

def get_checkpoint_repo(request: Request) -> CheckpointRepository:
    client = get_mongo_client(request)
    return CheckpointRepository(mongo=client)

def get_harness_repo(request: Request) -> HarnessRepository:
    client = get_mongo_client(request)
    return HarnessRepository(mongo=client)

def get_evaluation_repo(request: Request) -> EvaluationRepository:
    client = get_mongo_client(request)
    return EvaluationRepository(mongo=client)

def get_evidence_repo(request: Request) -> EvidenceRepository:
    client = get_mongo_client(request)
    return EvidenceRepository(mongo=client)

def get_memory_repo(request: Request) -> MemoryRepository:
    client = get_mongo_client(request)
    return MemoryRepository(mongo=client)

def get_integration_event_repo(request: Request) -> IntegrationEventRepository:
    client = get_mongo_client(request)
    return IntegrationEventRepository(mongo=client)
