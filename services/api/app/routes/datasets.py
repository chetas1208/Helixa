from __future__ import annotations

import gzip
import logging
import zlib

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from services.api.app.dependencies import get_dataset_repo, get_mongo_client
from services.integrations.mongodb import DatasetModel, DatasetRepository, MongoDBClient
from services.runtime.genomics.ingestion import (
    FileIngestionService,
    IngestionLimitExceeded,
    InvalidGenomicFileError,
)

logger = logging.getLogger("diamond.api.datasets")

router = APIRouter(prefix="/api/datasets", tags=["datasets"])

@router.get("")
async def list_datasets(dataset_repo: DatasetRepository = Depends(get_dataset_repo)):
    datasets = await dataset_repo.list_datasets()
    result = []
    for d in datasets:
        fixtures_count = len(d.fixtures) if isinstance(d.fixtures, (dict, list)) else 0
        result.append({
            "dataset_id": d.dataset_id,
            "manifest_version": d.manifest_version,
            "declared_assembly": d.declared_assembly,
            "is_synthetic": d.is_synthetic,
            "reference": d.reference,
            "fixtures_count": fixtures_count,
        })
    return {"datasets": result}

@router.get("/{id}")
async def get_dataset(id: str, dataset_repo: DatasetRepository = Depends(get_dataset_repo)):
    ds = await dataset_repo.get_dataset(id)
    if not ds:
        raise HTTPException(status_code=404, detail=f"Dataset '{id}' not found")
    return ds.model_dump(mode="json")

@router.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    mongo: MongoDBClient = Depends(get_mongo_client),
):
    """
    Streams uploaded VCF/FASTA file directly to CAS with streaming SHA-256 computation,
    format detection, decompression bomb guards, and dataset manifest creation.
    """
    service = FileIngestionService()
    try:
        artifact, manifest = service.stream_and_persist(
            stream=file.file,
            original_filename=file.filename or "uploaded.vcf",
        )
    except IngestionLimitExceeded as e:
        raise HTTPException(status_code=413, detail=str(e))
    except (InvalidGenomicFileError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except (EOFError, gzip.BadGzipFile, zlib.error):
        raise HTTPException(status_code=400, detail="Uploaded gzip stream is corrupt or truncated")
    except Exception:
        logger.exception("Dataset ingestion failed")
        raise HTTPException(status_code=500, detail="Ingestion failed")

    # Persist dataset manifest to MongoDB
    ds_model = DatasetModel(
        dataset_id=manifest.dataset_id,
        manifest_version=manifest.manifest_version,
        declared_assembly=manifest.declared_assembly or "UNKNOWN",
        is_synthetic=manifest.is_synthetic,
        reference={"checksum": manifest.reference_checksum},
        fixtures={"primary_artifact": artifact.storage_path},
        metadata=manifest.metadata,
    )
    try:
        await mongo.db.datasets.replace_one(
            {"dataset_id": ds_model.dataset_id},
            ds_model.model_dump(mode="json"),
            upsert=True,
        )
        await mongo.db.artifacts.replace_one(
            {"artifact_sha256": artifact.artifact_sha256},
            artifact.model_dump(mode="json"),
            upsert=True,
        )
    except Exception:
        # Graceful degradation if MongoDB is not reachable
        pass

    return {
        "status": "INGESTED",
        "dataset_id": manifest.dataset_id,
        "artifact": artifact.model_dump(mode="json"),
        "manifest": manifest.model_dump(mode="json"),
    }
