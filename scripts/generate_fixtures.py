import hashlib
import os

import pysam

# Ensure directories exist
os.makedirs("fixtures/references", exist_ok=True)
os.makedirs("fixtures/valid", exist_ok=True)
os.makedirs("fixtures/invalid", exist_ok=True)
os.makedirs("fixtures/heldout", exist_ok=True)
os.makedirs("fixtures/manifests", exist_ok=True)

# 1. Generate Synthetic Reference FASTA (chr22, 120,000 bp)
# Deterministic pseudo-random pattern seeded for exact reproducibility
fasta_path = "fixtures/references/ref_synthetic_chr22.fasta"
pattern = "ACGTGCAGTGTAGCTAGCTAGCTGATCGATCGTAGCTAGCTAGCTGACTGATCGATCGATCGTAGCTAGCTGATCGATCGATCGTAGCTAGCTA" * 1250 # 120,000 bp

# Insert specific known nucleotides at exact test positions:
seq_list = list(pattern[:120000])

# Position 10001 (0-indexed 10000): 'A'
seq_list[10000] = 'A'
# Position 10002 (0-indexed 10001): 'C'
seq_list[10001] = 'C'
# Position 105002 (0-indexed 105001): 'T' (for the incident: VCF says REF='G', FASTA has 'T')
seq_list[105001] = 'T'
# Position 106000 (0-indexed 105999): 'G' (for multiallelic)
seq_list[105999] = 'G'
# Position 107000 (0-indexed 106999): 'C' (for indel)
seq_list[106999] = 'C'
# Position 110000 (0-indexed 109999): 'A' (for heldout mismatch)
seq_list[109999] = 'A'

fixed_seq = "".join(seq_list)

with open(fasta_path, "w") as f:
    f.write(">chr22\n")
    # Write 60 characters per line
    for i in range(0, len(fixed_seq), 60):
        f.write(fixed_seq[i:i+60] + "\n")

# Index with pysam.faidx
pysam.faidx(fasta_path)
print("Reference FASTA created and indexed:", fasta_path)

# Compute FASTA SHA-256
with open(fasta_path, "rb") as f:
    fasta_hash = hashlib.sha256(f.read()).hexdigest()

# 2. Generate Valid SNVs VCF
valid_vcf = "fixtures/valid/valid_snvs.vcf"
with open(valid_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr22\t10001\trs101\tA\tG\t50\tPASS\tDP=35\tGT\t0/1
chr22\t10002\trs102\tC\tT\t60\tPASS\tDP=42\tGT\t1/1
""")

# 3. Generate Valid Multi-allelic VCF
multi_vcf = "fixtures/valid/multiallelic_snvs.vcf"
with open(multi_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr22\t106000\trs106\tG\tA,C\t70\tPASS\tDP=50\tGT\t1/2
""")

# 4. Generate Valid Indel VCF
indel_vcf = "fixtures/valid/normalization_indel.vcf"
with open(indel_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr22\t107000\trs107\tC\tCATG\t65\tPASS\tDP=38\tGT\t0/1
""")

# 5. Generate Invalid: REF Mismatch (The Incident)
# POS 105002 in FASTA has 'T', but VCF declares REF='G'
incident_vcf = "fixtures/invalid/ref_mismatch.vcf"
with open(incident_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr22\t10001\trs101\tA\tG\t50\tPASS\tDP=35\tGT\t0/1
chr22\t105002\trs999\tG\tA\t45\tPASS\tDP=28\tGT\t0/1
""")

# 6. Generate Invalid: Absent Assembly Declaration
no_assembly_vcf = "fixtures/invalid/absent_assembly.vcf"
with open(no_assembly_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr22\t10001\trs101\tA\tG\t50\tPASS\tDP=35\tGT\t0/1
""")

# 7. Generate Invalid: Unsupported Contig
unsupported_contig_vcf = "fixtures/invalid/unsupported_contig.vcf"
with open(unsupported_contig_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr99,length=50000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr99\t500\trs99\tA\tG\t50\tPASS\tDP=30\tGT\t0/1
""")

# 8. Generate Invalid: Malformed Record (invalid characters in POS / empty REF)
malformed_vcf = "fixtures/invalid/malformed_record.vcf"
with open(malformed_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO
chr22\tINVALID_POS\trs101\tA\tG\t50\tPASS\t.
""")

# 9. Generate Invalid: Position exceeds contig length (Length Mismatch)
length_mismatch_vcf = "fixtures/invalid/length_mismatch.vcf"
with open(length_mismatch_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO
chr22\t9999999\trs888\tA\tG\t50\tPASS\t.
""")

# 10. Generate Sealed Held-out Case (Unseen Mismatch on position 110000)
# FASTA has 'A', VCF declares REF='C'
heldout_vcf = "fixtures/heldout/unseen_mismatch.vcf"
with open(heldout_vcf, "w") as f:
    f.write("""##fileformat=VCFv4.2
##reference=GRCh38
##contig=<ID=chr22,length=120000>
##INFO=<ID=DP,Number=1,Type=Integer,Description="Total Depth">
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE001
chr22\t110000\trsholdout\tC\tG\t55\tPASS\tDP=40\tGT\t0/1
""")

print("All synthetic fixtures generated successfully.")
