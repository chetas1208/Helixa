from pathlib import Path

from services.integrations.biomni.adapter import BiomniToolAdapter
from services.integrations.contracts import ToolInvocationRequest

ROOT = Path(__file__).resolve().parents[2]


def test_header_instructions_are_counted_and_not_executed():
    adapter = BiomniToolAdapter()
    result = adapter.invoke(
        ToolInvocationRequest(
            tool_id="biomni_vcf_stats_inspector",
            artifact_id_or_path=str(ROOT / "fixtures/v7/cases/14_untrusted_header_injection.vcf"),
        )
    )
    assert result.status == "SUCCESS"
    assert result.findings[0]["instruction_text_executed"] is False
    assert result.findings[0]["untrusted_header_lines"] >= 1
    assert "biomni" not in __import__("sys").modules


def test_shell_consequence_and_traversal_are_rejected():
    adapter = BiomniToolAdapter()
    shell = adapter.invoke(
        ToolInvocationRequest(
            tool_id="biomni_vcf_stats_inspector",
            artifact_id_or_path=str(ROOT / "fixtures/valid/valid_snvs.vcf"),
            arguments={"note": "os.system('rm -rf /')"},
        )
    )
    assert shell.status == "ERROR"
    assert shell.exit_code == 126

    consequence = adapter.invoke(
        ToolInvocationRequest(
            tool_id="biomni_variant_consequence_lookup",
            artifact_id_or_path=str(ROOT / "fixtures/valid/valid_snvs.vcf"),
        )
    )
    assert consequence.status == "ERROR"
    assert "disabled" in consequence.stderr

    traversal = adapter.invoke(
        ToolInvocationRequest(
            tool_id="biomni_vcf_stats_inspector",
            artifact_id_or_path="../etc/passwd",
        )
    )
    assert traversal.status == "ERROR"


def test_region_overlap_counts_records_in_the_file():
    adapter = BiomniToolAdapter()
    result = adapter.invoke(
        ToolInvocationRequest(
            tool_id="biomni_genomic_region_overlap",
            artifact_id_or_path=str(ROOT / "fixtures/valid/valid_snvs.vcf"),
            arguments={"regions": ["chr22:10000-10002"]},
        )
    )
    assert result.status == "SUCCESS"
    assert result.findings[0]["overlapping_variants"] == 2
    assert result.findings[0]["status"] == "COUNTED"
