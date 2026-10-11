/**
 * Emit anatomy-mesh-manifest.json + anatomyTree.local.json from the TS catalog.
 * Run from apps/web: npx vite-node ../../scripts/anatomy/emit_fixtures.ts
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalTree, buildManifest } from "../../apps/web/src/features/anatomy/catalog";

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, "../../apps/web/src/features/anatomy");

writeFileSync(resolve(dest, "anatomy-mesh-manifest.json"), `${JSON.stringify(buildManifest(), null, 2)}\n`);
writeFileSync(resolve(dest, "anatomyTree.local.json"), `${JSON.stringify(buildLocalTree(), null, 2)}\n`);
console.log("wrote anatomy-mesh-manifest.json and anatomyTree.local.json");
