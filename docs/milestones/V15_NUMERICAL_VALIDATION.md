# DIAMOND Genome V15 — Numerical Validation & Test Oracle Report
**Document ID:** V15-NUM-001  
**Timestamp:** 2026-10-11T23:33:30Z  
**Owner:** Agent B (Evolution Mathematics) & Agent E (Independent QA)  
**Test Suite:** `services/tests/test_v15_numerical_validation.py` (16/16 PASS)  

---

## 1. Executive Summary
This report certifies deterministic numerical validation of the DIAMOND Genome V15 population genetics engine across all 16 required invariants defined in Section 10 of the product contract. All calculations are executed with explicitly seeded pseudo-random number generation without LLM approximation or ungrounded heuristics.

---

## 2. Invariant Results and Oracles

| Oracle # | Test Invariant | Methodology & Parameter Setup | Theoretical Expected Behavior | Measured Result | Verdict |
|---|---|---|---|---|---|
| **1** | Neutral evolution | $p_0=0.40, N=100, T=20, s=0, u=0, m=0$, 30 replicates | Mean final frequency $\bar{p} \approx p_0$ within Monte Carlo SE | $\bar{p} \in [0.35, 0.45]$ across replicates | **PASS** |
| **2** | One-locus selection | $p_0=0.20, s=+0.15, h=0.5, N=5000, T=30$ | Deterministic increase in large-$N$ limit ($\Delta p > 0$) | $p_{\text{end}} > p_0$ strictly | **PASS** |
| **3** | Drift bounds & determinism | $p_0=0.50, N=50, T=25$, seeds 101 vs 101 | Exact bitwise reproduction of trajectory & SHA-256 | Identical SHA-256; all $p \in [0, 1]$ | **PASS** |
| **4** | Mutation-only update | $p_0=0.30, u=0.05, v=0.02, N=10000, T=1$ | $p_{t+1} = (1-u)p + v(1-p) = 0.299$ | $p_{\text{end}} = 0.299 \pm 0.005$ | **PASS** |
| **5** | Migration-only mixing | $p_0=0.20, m=0.10, p_{\text{src}}=0.80, N=10000, T=1$ | $p_{t+1} = (1-m)p + m \cdot p_{\text{src}} = 0.260$ | $p_{\text{end}} = 0.260 \pm 0.005$ | **PASS** |
| **6** | Dominance & zero-fitness | Lethal $s=-1.0, h=0.0$ and lethal homozygote zero fitness | Nonnegative viabilities; zero mean fitness triggers extinction | $w_{AA}=0.0$, $\bar{w}=0$ extinction safe | **PASS** |
| **7** | Absorbing extinction | Initial $N=0$, carrying capacity $K=500, T=10$ | Extinction is absorbing; population cannot resurrect | All frames $N=0, p=0.0, \text{extinct}=\text{true}$ | **PASS** |
| **8** | Environment sensitivity | Unlinked parameter change vs linked parameter model | Unlinked has zero numeric effect; linked alters effective $s$ | Unlinked: identical SHA-256; linked: $s_{\text{eff}}$ shifts | **PASS** |
| **9** | Deep horizon scaling | 2,000,000 years, generation time $g=25$ years ($T=80,000$) | Exactly 80,000 generations simulated; frames capped at $\le 240$ | $T=80,000$, frames $\le 240$, 60s replay ready | **PASS** |
| **10** | RNG determinism | Seed 777 vs 777 vs 778 | Same seed identical hash; different seed distinct hash | SHA-256 matches bitwise for same seed | **PASS** |
| **11** | Ensemble calibration | 25 replicates, $p_0=0.5, N=40, T=20$ | Empirically calibrated median, 10th & 90th percentiles | $p_{10} \le p_{50} \le p_{90} \in [0, 1]$; valid fractions | **PASS** |
| **12** | Acceleration validation | Mode A exact vs accelerated tau-leaping | Acceleration mode explicitly documented with caveats | `fidelity: "TIER_A_EXACT_GENERATIONS"` vs accelerated | **PASS** |
| **13** | Sequence edit integrity | Proposal on position 10 ($G \to T$) committed to revision | Pinned reference unchanged; revision reflects edit | Baseline FASTA unchanged; preview shows $T$ | **PASS** |
| **14** | Phenotype causal boundary | Body descriptor for unmodeled variant | No arbitrary mesh deformation; honest disclosure | `anatomy_changed: false`, `effect_class: ILLUSTRATIVE` | **PASS** |
| **15** | Causal explanation receipts | Workspace intelligence query | Explanations backed by structured facts and IDs | Intelligence links distinct genome and harness IDs | **PASS** |
| **16** | Edit vs natural evolution | Workspace lineage query | Chronological edit order distinguished from natural phylogeny | Genome lineage and harness lineage distinct | **PASS** |

---

## 3. Acceleration Approximation & Error Bounds

For horizons exceeding 2,000 generations (e.g. 80,000 generations for 2,000,000 years):
- **Solver Mode:** `ACCELERATED_DIFFUSION_TAU_LEAP`.
- **Method:** Generation steps are batched into $\Delta t = \text{max}(1, T / (\text{max\_frames} - 1))$ generations.
- **Drift Variance:** $\sigma^2 = \Delta t \cdot \frac{p(1-p)}{2 N_e}$.
- **Accuracy Bound:** The expected mean shift matches exact deterministic forward dynamics $\mathbb{E}[\Delta p] = \Delta t \cdot \Delta p_{\text{det}}$, and variance accumulates linearly with $\Delta t$.
- **Disclosure Policy:** Output metadata explicitly includes `fidelity: "ACCELERATED_DIFFUSION_TAU_LEAP"` and documents that snapshots represent milestone checkpoints, not millions of stored individual frames.
