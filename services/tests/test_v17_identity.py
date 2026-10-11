"""Display name is HELIXA. Persistent service and database names stay put."""

from services.api.app.config import config
from services.api.app.routes.health import _product_display_name


def test_product_display_name_defaults_to_helixa(monkeypatch):
    monkeypatch.delenv("HELIXA_DISPLAY_NAME", raising=False)
    monkeypatch.delenv("HELIXA_APP_NAME", raising=False)
    assert _product_display_name() == "HELIXA"


def test_persistent_names_are_not_the_display_name():
    assert config.product_display_name == "HELIXA"
    assert config.mongodb_database
    assert config.mongodb_database != "HELIXA"
    assert config.mongodb_app_name != "HELIXA"
