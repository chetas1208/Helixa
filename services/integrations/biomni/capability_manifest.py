from __future__ import annotations

from services.integrations.contracts import ScientificToolManifest

BIOMNI_CAPABILITY_MANIFESTS: dict[str, ScientificToolManifest] = {
    "biomni_vcf_stats_inspector": ScientificToolManifest(
        name="biomni_vcf_stats_inspector",
        version="1.0.0",
        description="Extracts deterministic summary statistics, variant type distributions, and Ti/Tv ratios from VCF datasets.",
        category="genomics_inspection",
        accepted_formats=["vcf", "vcf.gz"],
        supported_outputs=["json", "receipt"],
        deterministic=True,
        permission_level="read_only",
        resource_budget={"timeout_sec": 10.0, "max_memory_mb": 256},
    ),
    "biomni_reference_coordinate_liftover": ScientificToolManifest(
        name="biomni_reference_coordinate_liftover",
        version="1.0.0",
        description="Inspects and validates genomic coordinate translation boundaries between assembly builds (e.g. GRCh37/GRCh38).",
        category="coordinate_inspection",
        accepted_formats=["vcf", "bed"],
        supported_outputs=["json"],
        deterministic=True,
        permission_level="read_only",
        resource_budget={"timeout_sec": 10.0, "max_memory_mb": 256},
    ),
    "biomni_variant_consequence_lookup": ScientificToolManifest(
        name="biomni_variant_consequence_lookup",
        version="1.0.0",
        description="Performs deterministic structural and sequence consequence annotation on candidate variants.",
        category="consequence_annotation",
        accepted_formats=["vcf", "vcf.gz"],
        supported_outputs=["json"],
        deterministic=True,
        permission_level="read_only",
        resource_budget={"timeout_sec": 10.0, "max_memory_mb": 256},
    ),
    "biomni_genomic_region_overlap": ScientificToolManifest(
        name="biomni_genomic_region_overlap",
        version="1.0.0",
        description="Calculates interval overlap and intersection metrics between variant loci and designated target regions.",
        category="interval_inspection",
        accepted_formats=["vcf", "bed"],
        supported_outputs=["json"],
        deterministic=True,
        permission_level="read_only",
        resource_budget={"timeout_sec": 10.0, "max_memory_mb": 256},
    ),
}


def get_biomni_manifest(tool_id: str) -> ScientificToolManifest | None:
    return BIOMNI_CAPABILITY_MANIFESTS.get(tool_id)
