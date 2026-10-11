# Third-Party Notices & Dependency Licenses

DIAMOND Genome relies on open-source libraries and external dependencies. All third-party packages are maintained under their respective open-source licenses:

| Dependency | Purpose | License | Source / Upstream |
|---|---|---|---|
| **htslib / bcftools** | Deterministic VCF/BCF parsing, indexing, and reference verification | MIT / BSD / GPLv3 | [samtools/bcftools](https://github.com/samtools/bcftools) |
| **pysam** | Python C-API bindings to htslib | MIT | [pysam-developers/pysam](https://github.com/pysam-developers/pysam) |
| **FastAPI** | High-performance Python web framework | MIT | [tiangolo/fastapi](https://github.com/tiangolo/fastapi) |
| **PyMongo** | Official asynchronous MongoDB driver | Apache-2.0 | [mongodb/mongo-python-driver](https://github.com/mongodb/mongo-python-driver) |
| **Pydantic** | Typed schema definition and validation | MIT | [pydantic/pydantic](https://github.com/pydantic/pydantic) |
| **Three.js** | 3D graphics library | MIT | [mrdoob/three.js](https://github.com/mrdoob/three.js) |
| **React Three Fiber** | Declarative Three.js for React | MIT | [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) |
| **Drei** | Reusable helpers for React Three Fiber | MIT | [pmndrs/drei](https://github.com/pmndrs/drei) |
| **Zustand** | Bearbones state management | MIT | [pmndrs/zustand](https://github.com/pmndrs/zustand) |
| **TanStack Query** | Asynchronous state management | MIT | [TanStack/query](https://github.com/TanStack/query) |
| **Tailwind CSS** | Utility-first CSS framework | MIT | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| **Lucide React** | Icons | ISC | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| **IGV.js** | Genomic locus inspector | MIT | [igvteam/igv.js](https://github.com/igvteam/igv.js) |
| **EBI vcf-validator 0.10.2** | Independent VCF syntax and assembly-reference checks. Linux release binaries, checksum-pinned. | Apache-2.0 | [EBIvariation/vcf-validator](https://github.com/EBIvariation/vcf-validator) release `v0.10.2` |
| **GEPA 0.1.4** | Optional textual optimizer package. Installed; `optimize()` is not invoked by DIAMOND V8. | MIT | [gepa-ai/gepa](https://github.com/gepa-ai/gepa) commit `462e437a09be67d2acb59564cc0ea59132f5777c` |

Biomni (`400c1f366b96a35ca253e13c9b06c5076af41d65`, Apache-2.0) and Meta-Harness (`8123ccabe2b19fa1123090b2e5f1bacc20963ce8`, MIT) were inspected and are not imported. See `docs/integrations/V8_UPSTREAM_REPOSITORY_AUDIT.md`.

## Fonts

Instrument Sans, Newsreader, and JetBrains Mono are loaded through `@fontsource-variable` packages. Those typefaces are under the SIL Open Font License 1.1. The OFL applies to the font files, not to the HELIXA source.

## Data excerpts shipped as fixtures

The MIT license covers original code. It does not relicense these files:

| Path | Contents | Terms |
|---|---|---|
| `fixtures/references/ref_synthetic_chr22.fasta` | Original educational contig | Project fixture. Not GRCh38. |
| `fixtures/references/grch38_slices/` | Short GRCh38.p14 windows from Ensembl release 116, with a checksum manifest | EMBL-EBI data terms. Not a full genome. |
| `fixtures/v14/cache/ensembl/` | Gene and transcript records for the same panel | Ensembl / EMBL-EBI. Cite release 116. |
| `fixtures/v14/cache/ols4/` and Uberon ids in the anatomy catalog | Ontology labels and partonomy | Uberon CC BY 3.0, via OLS4. |
| `fixtures/v14/cache/hpa/` | Tissue annotation excerpts | Human Protein Atlas CC BY-SA 3.0. Share-alike applies to these excerpts. |
| `fixtures/v14/cache/bgee/` | Expression calls | Bgee data CC0. Cite Bgee. |
| `fixtures/v14/cache/gwas/` | Variant–trait association records | GWAS Catalog / EMBL-EBI terms. |

Z-Anatomy (CC BY-SA 4.0) and BodyParts3D (CC BY-SA 2.1 Japan) are not in the tree. Body geometry under `apps/web/src/features/anatomy/` is original parametric code.
