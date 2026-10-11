# DIAMOND Genome V15 — Population Genetics & Phenotype Model Card
**Document ID:** V15-MODEL-CARD-001  
**Timestamp:** 2026-10-11T23:33:40Z  
**Primary Architect:** Agent B (Evolution Mathematics) & Agent A (Genome Causality)  

---

## 1. Model Overview

DIAMOND Genome V15 implements forward-time population-genetic modeling and deterministic sequence-to-evidence analysis. It explicitly separates:
1. Deterministic in-silico nucleotide sequence editing on verified reference assemblies.
2. Annotation and evidence aggregation (transcripts, residues, tissue expression, GWAS associations).
3. Parameterized hypothetical population genetics under Earth environmental scenarios.
4. 3D visualization and narrative explanation.

---

## 2. Mathematical Equations and Validity Ranges

### 2.1 Diploid Wright–Fisher Dynamic Engine
Let $p_t$ be the frequency of focal allele $A$, $q_t = 1 - p_t$ of alternate allele $a$. Genotype viabilities:
$$w_{aa} = 1.0, \quad w_{Aa} = 1.0 + h \cdot s, \quad w_{AA} = 1.0 + s$$
where $s \in [-1.0, 10.0]$ is the selection coefficient and $h \in [0.0, 1.0]$ is the dominance coefficient ($h=0.5$ for additive fitness).

#### Selection:
$$\bar{w} = p^2 w_{AA} + 2pq w_{Aa} + q^2 w_{aa}$$
$$p_{\text{selected}} = \frac{p^2 w_{AA} + pq w_{Aa}}{\bar{w}}$$
*Edge Case:* If $\bar{w} \le 0$, reproduction is biologically impossible under the model; population transitions to absorbing extinction ($N=0, p=0$).

#### Mutation:
Forward mutation $u: A \to a$, reverse mutation $v: a \to A$, $u, v \in [0, 1]$:
$$p_{\text{mutated}} = (1 - u) p_{\text{selected}} + v (1 - p_{\text{selected}})$$

#### Migration:
Immigration fraction $m \in [0, 1]$ from source population with frequency $p_{\text{source}} \in [0, 1]$:
$$p_{\text{migrated}} = (1 - m) p_{\text{mutated}} + m \cdot p_{\text{source}}$$

#### Genetic Drift:
Diploid effective size $N_e$:
$$k_{t+1} \sim \text{Binomial}(2 N_e, p_{\text{migrated}}), \quad p_{t+1} = \frac{k_{t+1}}{2 N_e}$$

### 2.2 Demographic Ecology & Carrying Capacity
Density-regulated logistic demography with carrying capacity $K$ and intrinsic rate $r \in [-1.0, 2.0]$:
$$N_{t+1} = \max\left(0, \text{round}\left(N_t + r N_t \left(1 - \frac{N_t}{K}\right) + \delta_N\right)\right)$$
where $\delta_N \sim \mathcal{N}(0, \sqrt{N_t})$.
*Extinction Boundary:* If $N_t = 0$, $N_{t+k} = 0$ for all $k \ge 1$. Extinction is absorbing.

### 2.3 Environmental Selection Surface
$$s(t) = s_{\text{base}} + \sum_{k} c_k \cdot (E_k(t) - E_{k,\text{baseline}})$$
Parameters without an explicit model link remain tagged `NOT_MODELED` and exert zero numeric influence on trajectories.

---

## 3. Deep-Time Acceleration (Mode C)

For scenarios up to 2,000,000 years with human generation time $g=25$ years ($T=80,000$ generations):
- **Method:** `ACCELERATED_DIFFUSION_TAU_LEAP`.
- **Step Size:** $\Delta t = \text{floor}(T / (\text{max\_frames} - 1))$.
- **Diffusion Approximation:**
  $$p_{t+\Delta t} = \min\left(1.0, \max\left(0.0, p_t + \Delta t \cdot \Delta p_{\text{det}} + \sqrt{\Delta t \cdot \frac{p(1-p)}{2 N_e}} \cdot Z\right)\right)$$
  where $Z \sim \mathcal{N}(0, 1)$.
- **Caveat:** Snapshot interpolations are for visual playback only and are never branded as real intermediate generations.

---

## 4. Unsupported Claims and Limitations

1. **No Organism Anatomy from Arbitrary SNPs:** Body morphology cannot be calculated from arbitrary human genetic variants. Meshes are NOT deformed without an explicit, validated trait-to-geometry model.
2. **Not a Clinical Predictor:** Simulation outputs represent hypothetical population allele dynamics, not clinical diagnostic verdicts or individual health forecasts.
3. **No Goal-Directed Mutation:** The engine never simulates DNA intentionally mutating to solve environmental stress. Selection and demography change in response to the environment; mutations are undirected.
4. **SLiM Engine Mode:** Mode B requires a native SLiM binary. If uninstalled, the system honestly reports `UNAVAILABLE` and falls back to Mode A.
