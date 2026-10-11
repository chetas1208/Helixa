from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

root_env = Path(__file__).resolve().parents[3] / ".env"
if root_env.is_file():
    load_dotenv(root_env)
else:
    load_dotenv()

_mongo_db = os.getenv("MONGODB_DATABASE")
_helixa_db = os.getenv("HELIXA_DATABASE_NAME", "").strip()
if _mongo_db and _helixa_db and _mongo_db != _helixa_db:
    logging.getLogger("diamond.api").warning(
        "HELIXA_DATABASE_NAME differs from MONGODB_DATABASE; keeping MONGODB_DATABASE."
    )
_database_name = _mongo_db or _helixa_db or "diamond_genome"
_display_name = os.getenv("HELIXA_DISPLAY_NAME") or os.getenv("HELIXA_APP_NAME") or "HELIXA"


class AppConfig(BaseModel):

    app_env: str = os.getenv("APP_ENV", "development")
    api_host: str = os.getenv("API_HOST", "127.0.0.1")
    api_port: int = int(os.getenv("API_PORT", "8000"))
    mongodb_uri: str = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
    mongodb_database: str = _database_name
    mongodb_app_name: str = os.getenv("MONGODB_APP_NAME", "diamond-genome")
    product_display_name: str = _display_name
    artifact_namespace: str = os.getenv("HELIXA_ARTIFACT_NAMESPACE", "").strip()
    mongodb_server_selection_timeout_ms: int = int(os.getenv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", "5000"))
    mongodb_connect_timeout_ms: int = int(os.getenv("MONGODB_CONNECT_TIMEOUT_MS", "5000"))
    mongodb_require_atlas: bool = os.getenv("MONGODB_REQUIRE_ATLAS", "false").lower() in ("true", "1", "yes")
    mongodb_min_pool_size: int = int(os.getenv("MONGODB_MIN_POOL_SIZE", "5"))
    mongodb_max_pool_size: int = int(os.getenv("MONGODB_MAX_POOL_SIZE", "50"))
    max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "25"))
    fixtures_dir: str = os.getenv("FIXTURES_DIR", "fixtures")

config = AppConfig()
