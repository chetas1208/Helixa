# V11 integration graph

```
synthetic FASTA
    -> workspace revision (JSON file)
    -> Wright–Fisher request (ploidy 1 or 2)
    -> stored frames + sha256
    -> Studio tabs read the same active workspace id
```

`services/runtime/evolution/` remains the harness-search package. Population math is `services/runtime/population/`.

Studio is one React view. Genome, Intelligence, Library, and Sandbox are tabs in that view. Selecting a library card clears the simulation and the intelligence cache so a previous workspace cannot keep its frames on screen.

`/api/v10` is still the route prefix. A second parallel API was not added.
