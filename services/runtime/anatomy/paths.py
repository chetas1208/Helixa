"""Fixture locations for the V14 anatomy package. Slices are read-only."""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_V14 = REPO_ROOT / "fixtures" / "v14"
CACHE_DIR = FIXTURES_V14 / "cache"
SLICES_DIR = REPO_ROOT / "fixtures" / "references" / "grch38_slices"

TREE_PATH = FIXTURES_V14 / "anatomy_tree.json"
SYSTEMS_PATH = FIXTURES_V14 / "systems.json"
GENES_PATH = FIXTURES_V14 / "genes.json"
LOCI_MANIFEST_PATH = SLICES_DIR / "manifest.json"
HPA_TISSUE_MAP_PATH = FIXTURES_V14 / "hpa_tissue_map.json"
BGEE_ANATOMY_MAP_PATH = FIXTURES_V14 / "bgee_anatomy_map.json"
SOURCE_META_PATH = CACHE_DIR / "source_meta.json"

OLS4_CACHE = CACHE_DIR / "ols4"
ENSEMBL_CACHE = CACHE_DIR / "ensembl"
BGEE_CACHE = CACHE_DIR / "bgee"
HPA_CACHE = CACHE_DIR / "hpa"
GWAS_CACHE = CACHE_DIR / "gwas"

USER_AGENT = "DIAMOND-V14/1.0 (educational research; local Diamond_Proj; not a browser)"
EXPRESSION_CAVEAT = (
    "Expression shows the gene is active in this tissue. "
    "It does not show that editing it changes this organ."
)
GWAS_CAVEAT = (
    "This is a statistical association from a published GWAS. "
    "It does not show that editing the variant changes this organ or trait."
)
REFERENCE_ASSET_ID = "grch38_slices_ensembl116"
ENSEMBL_RELEASE = 116
ASSEMBLY = "GRCh38"
ASSEMBLY_PATCH = "GRCh38.p14"
UBERON_VERSION_IRI = "http://purl.obolibrary.org/obo/uberon/releases/2026-10-01/uberon.owl"
UBERON_VERSION = "2026-10-01"
