# HELIXA branding migration

Public product name: **HELIXA — The Living Genome Studio**  
Tagline: **Explore Life's Code.**  
GitHub repository: `Helixa`

The repository used to present itself as DIAMOND Genome. The public name changed. Internal identifiers that already shipped in code, databases, and anatomy records were left in place so existing workspaces, tests, and APIs keep working.

## Renamed in the user-facing surface

| Surface | Now |
|---|---|
| Browser title | `HELIXA` |
| Document description | HELIXA — The Living Genome Studio. Explore Life's Code. |
| Top bar wordmark | HELIXA |
| Web app manifest | HELIXA |
| Connection detail when the API is online | Connected to the HELIXA API. |
| Python package description | Names HELIXA. The distribution name stays `diamond-genome`. |

## Intentionally unchanged

| Identifier | Why it stays |
|---|---|
| Package / distribution name `diamond-genome` | Import and install name. Not shown as the product title. |
| `MONGODB_DATABASE=diamond_genome` in `.env.example` | Existing local databases and indexes use this name. `HELIXA_DATABASE_NAME` is display-only and does not override it. |
| `MONGODB_APP_NAME=diamond-genome` | Driver app name for an existing deployment. |
| Anatomy ids prefixed `DIAMOND:` | Stable ids in the local atlas (`DIAMOND:region-head-face`, digit ids). Renaming them would break selection and tests. |
| API routes under `/api`, `/api/v10`, `/api/genome-edit` | Clients and tests call these paths. |
| Docker service layout `services/api` and `apps/web` | Image build contexts. Not renamed. |
| Historical commits and milestone docs | They describe the work under the name used at the time. |

## Four tabs

The studio has four sections. Accessible names come from `TAB_TITLES` in `apps/web/src/v12/types.ts`:

1. Genome Editor
2. Genome & Harness Evolution
3. Earth Evolution Sandbox
4. Harness Library

Compact labels on a phone are Evolution, Earth, and the full names for the editor and library. Tab ids remain `editor`, `evolution`, `simulation`, and `library`.
