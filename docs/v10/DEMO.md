# V10 demo

```bash
make demo-v10
```

That writes `artifacts/v10/demo_state.json`, commits one illustrative base on the synthetic contig, and runs 2,000 model years at 25 years per generation (80 generations), seed 1, educational selection coefficient 0.15. Temperature 12 is stored and not modeled.

The Studio screen in the web app calls the same routes. Try 2,000,000 years at a 25-year generation and the API refuses with the generation count. It does not play a fake full-genome timeline.

SLiM smoke is not a target. The executable is absent.
