# Scientific Scope & Documented Limitations

## Research Use Only (RUO)
DIAMOND Genome is strictly a computational integrity and workflow verification tool. It is **not** a clinical diagnostic instrument, does not predict variant pathogenicity (e.g., ACMG/AMP classifications), does not recommend therapeutics, and does not design gene-editing reagents.

## Documented Genomic Limitations

1. **Assembly Detection vs Verification**:
   - A declared assembly header (e.g. `##reference=GRCh38`) in a VCF does not prove the coordinates are valid GRCh38.
   - DIAMOND explicitly checks nucleotide coordinates against provided FASTA files. If no matching FASTA is provided, status is marked `INCONCLUSIVE` rather than guessed.

2. **No Automatic Liftover**:
   - When coordinates or contigs mismatch, DIAMOND does **not** silently perform coordinate liftover (e.g., CrossMap/Liftover). Liftover can introduce subtle strand and indels errors without explicit human review.

3. **Allele Swapping Prohibited**:
   - bcftools `norm --check-ref s` auto-swaps REF and ALT alleles if REF does not match the reference genome. DIAMOND strictly forbids auto-swapping in validation mode (`norm --check-ref e` or deterministic pysam checking), because a mismatch often indicates an entirely wrong reference genome build.

4. **Multi-allelic and Complex Indels**:
   - Complex structural variants (>1kb) and tandem repeats require specialized graph-based aligners. Current deterministic checks focus on SNVs, short indels (<=50bp), and canonical contigs.
