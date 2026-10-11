# HELIXA — Name History, Provenance, and Migration Architecture
**Document ID:** BRAND-PROV-001  
**Timestamp:** 2026-10-11T23:47:30Z  
**Product Title:** HELIXA (formerly DIAMOND Genome)  
**Classification:** Public Engineering & Provenance Documentation  

---

## 1. Executive Summary & Brand Genesis

**HELIXA** is an interactive genome engineering, scientific evidence, and hypothetical evolutionary simulation platform. Its core promise is:
> **Explore DNA. Understand change.**

The platform was originally designed, developed, and benchmarked under the working project title **DIAMOND Genome** across Milestones M01 through V15. The rebrand to HELIXA marks the transition from an exploratory hackathon research prototype to a cohesive, production-grade scientific studio.

The name **HELIXA** reflects:
1. **The Molecular Helix:** The double-stranded nucleic acid architecture that forms the fundamental coordinate system of all living organisms.
2. **The Intertwined 'H' Motif:** A subtle geometric mark representing the dual nature of our platform—empirical molecular biology paired with predictive forward-time evolutionary dynamics.
3. **Causal Horizon:** Exploration across modeled deep-time generations without false deterministic claims or pseudoscientific phenotype predictions.

---

## 2. Provenance Integrity & Preserved Historical Identifiers

A core architectural principle of this rebrand is **preservation of engineering truth over cosmetic revisionism**. We do not rewrite git histories, invalidate cryptographic receipts, or destructively alter database collections to pretend earlier milestones did not exist.

The following layers remain intentionally preserved:

| Subsystem / Layer | Persistent Identifier | Rational & Compatibility Guarantee |
|---|---|---|
| **MongoDB Database** | `diamond_genome` | Default database name preserved to guarantee zero downtime and immediate connectivity to existing collections. |
| **Microservice Identifier** | `diamond-genome-api` / `diamond-genome` | Preserved in process registries, service discovery, and container metadata. |
| **Anatomical Ontology Namespace** | `DIAMOND:<organ_slug>` | Anatomical mesh nodes lacking standard lateral Uberon classes remain tagged with `DIAMOND:` to preserve URI stability. |
| **Cryptographic Receipts** | SHA-256 evidence digests | Historical run receipts signed under earlier milestones retain their valid tamper-proof hashes. |
| **Living Journals** | `PROGRESS.md` & `DECISIONS.md` | Historical milestone entries M01–V16 remain append-only records of genuine engineering progression. |

---

## 3. Configuration & Namespace Aliasing

The backend configuration (`services/api/app/config.py`) implements a backwards-compatible namespace adapter. Environment variables support both legacy deployments and modern `HELIXA_*` declarations with documented precedence:

```bash
# Public Display Names
HELIXA_APP_NAME="HELIXA"
HELIXA_DISPLAY_NAME="HELIXA"

# Database Configuration (Legacy preserved by default)
MONGODB_DATABASE="diamond_genome"
HELIXA_DATABASE_NAME="diamond_genome"  # Optional alias; logs warning if divergent

# Service & Telemetry Identifiers
MONGODB_APP_NAME="diamond-genome"
HELIXA_ARTIFACT_NAMESPACE=""
```

When `HELIXA_DATABASE_NAME` is provided, it must match `MONGODB_DATABASE` or the engine logs an explicit warning and honors `MONGODB_DATABASE` to prevent accidental database bifurcation.

---

## 4. Scientific Boundaries & Non-Commercial Disclaimer

HELIXA is strictly an in-silico research and exploration platform:
- In-silico point mutations are deterministic sequence operations; they do not imply historical evolutionary descent.
- Molecular annotations and tissue expression associations do not constitute clinical diagnoses, therapeutic recommendations, or proven phenotypic causation.
- Forward-time population trajectories are stochastic mathematical models conditioned on declared assumptions, not predictions of future human extinction.
- Procedural human anatomy meshes illustrate regions of interest; they never deform organism proportions without validated phenotype-to-geometry models.
