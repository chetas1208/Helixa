import os

import pytest
from pymongo.errors import ConfigurationError

from services.integrations.mongodb import MongoDBClient, sanitize_mongodb_uri

AUDIT_DB = "diamond_audit_mongo_client"
CONFIG_ENV = (
    "MONGODB_URI",
    "MONGODB_APP_NAME",
    "MONGODB_SERVER_SELECTION_TIMEOUT_MS",
    "MONGODB_CONNECT_TIMEOUT_MS",
    "MONGODB_MIN_POOL_SIZE",
    "MONGODB_MAX_POOL_SIZE",
    "MONGODB_REQUIRE_ATLAS",
)


@pytest.fixture
def clean_env(monkeypatch):
    for name in CONFIG_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("APP_ENV", raising=False)


def test_sanitize_masks_password_containing_unencoded_at():
    raw = "mongodb+srv://admin_user:SuperSecretP@ss123@cluster0.abcde.mongodb.net/db?retryWrites=true"
    sanitized = sanitize_mongodb_uri(raw)
    assert "SuperSecretP" not in sanitized
    assert "ss123" not in sanitized
    assert sanitized == "mongodb+srv://admin_user:****@cluster0.abcde.mongodb.net/db?retryWrites=true"


def test_sanitize_masks_simple_credentials():
    assert (
        sanitize_mongodb_uri("mongodb://user:pw@host1:27017,host2:27017/db?authSource=admin")
        == "mongodb://user:****@host1:27017,host2:27017/db?authSource=admin"
    )


def test_sanitize_leaves_credentialless_uri_untouched():
    for uri in (
        "mongodb://127.0.0.1:27017",
        "mongodb://127.0.0.1:27017/db?appName=a@b",
        "mongodb://h1:27017,h2:27017/db",
        "",
    ):
        assert sanitize_mongodb_uri(uri) == uri


@pytest.mark.parametrize(
    "uri",
    [
        "mongodb://127.0.0.1:27017/atlas_db",
        "mongodb://atlas_user:pw@127.0.0.1:27017",
        "mongodb://atlas.internal.example:27017",
        "mongodb://127.0.0.1:27017/db?appName=mongodb.net",
        "mongodb://user:mongodb.net@127.0.0.1:27017",
    ],
)
def test_local_uri_is_not_atlas(clean_env, uri):
    client = MongoDBClient(uri=uri, db_name=AUDIT_DB, require_atlas=False)
    assert client.is_atlas_uri is False
    assert client.deployment_mode == "local"
    with pytest.raises(ConfigurationError):
        MongoDBClient(uri=uri, db_name=AUDIT_DB, require_atlas=True)


@pytest.mark.parametrize(
    "uri",
    [
        "mongodb+srv://user:pw@cluster0.abcde.mongodb.net/db",
        "MONGODB+SRV://cluster0.abcde.mongodb.net",
        "mongodb://user:pw@c0-shard-00-00.abcde.mongodb.net:27017,c0-shard-00-01.abcde.mongodb.net:27017/db",
    ],
)
def test_atlas_uri_is_atlas(clean_env, uri):
    client = MongoDBClient(uri=uri, db_name=AUDIT_DB, require_atlas=True)
    assert client.is_atlas_uri is True
    assert client.deployment_mode == "atlas-hackathon"


def test_explicit_zero_options_are_honored(clean_env):
    client = MongoDBClient(
        uri="mongodb://127.0.0.1:27017",
        db_name=AUDIT_DB,
        min_pool_size=0,
        max_pool_size=0,
        server_selection_timeout_ms=0,
        connect_timeout_ms=0,
        require_atlas=False,
    )
    assert client.min_pool_size == 0
    assert client.max_pool_size == 0
    assert client.server_selection_timeout_ms == 0
    assert client.connect_timeout_ms == 0


def test_defaults_come_from_env_then_builtin(clean_env, monkeypatch):
    client = MongoDBClient(db_name=AUDIT_DB)
    assert client.uri == "mongodb://127.0.0.1:27017"
    assert (client.min_pool_size, client.max_pool_size) == (5, 50)
    assert (client.server_selection_timeout_ms, client.connect_timeout_ms) == (5000, 5000)
    monkeypatch.setenv("MONGODB_MIN_POOL_SIZE", "0")
    monkeypatch.setenv("MONGODB_MAX_POOL_SIZE", "7")
    client = MongoDBClient(db_name=AUDIT_DB)
    assert (client.min_pool_size, client.max_pool_size) == (0, 7)
    client = MongoDBClient(db_name=AUDIT_DB, min_pool_size=2)
    assert (client.min_pool_size, client.max_pool_size) == (2, 7)


@pytest.mark.asyncio
async def test_not_configured_status(clean_env):
    client = MongoDBClient(uri="mongodb://", db_name=AUDIT_DB, require_atlas=False)
    status = await client.check_status()
    assert status["status"] == "NOT_CONFIGURED"
    assert status["write_verified"] is False


@pytest.mark.asyncio
async def test_inaccessible_status_does_not_leak_password(clean_env):
    client = MongoDBClient(
        uri="mongodb://user:TopSecretPw@127.0.0.1:1/?serverSelectionTimeoutMS=200",
        db_name=AUDIT_DB,
        server_selection_timeout_ms=200,
        connect_timeout_ms=200,
        min_pool_size=0,
        require_atlas=False,
    )
    try:
        status = await client.check_status()
    finally:
        await client.close()
    assert status["status"] == "INACCESSIBLE"
    assert status["write_verified"] is False
    assert "TopSecretPw" not in repr(status)


@pytest.mark.asyncio
async def test_live_status_indexes_and_close_are_idempotent(clean_env):
    if os.getenv("MONGODB_DATABASE") != AUDIT_DB:
        pytest.skip("requires MONGODB_DATABASE=" + AUDIT_DB)
    client = MongoDBClient(require_atlas=False)
    assert client.db_name == AUDIT_DB
    try:
        status = await client.check_status()
        assert status["status"] == "WRITE_VERIFIED"
        assert status["database"] == AUDIT_DB
        assert await client.db.integration_events.count_documents({"component": "probe"}) == 0
        first = await client.init_indexes()
        second = await client.init_indexes()
        assert first == second
        assert len(first) == 12
    finally:
        await client.client.drop_database(AUDIT_DB)
        await client.close()
        await client.close()
