/**
 * Validate the shipped anatomy JSON fixtures (acyclic tree, laterality, hotspot ids).
 * node scripts/anatomy/validate_atlas.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dest = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/web/src/features/anatomy");
const manifest = JSON.parse(readFileSync(resolve(dest, "anatomy-mesh-manifest.json"), "utf8"));
const tree = JSON.parse(readFileSync(resolve(dest, "anatomyTree.local.json"), "utf8"));

const errors = [];
const ids = new Set(tree.nodes.map((n) => n.id));
if (ids.size !== tree.nodes.length) errors.push("duplicate node ids");

const kids = new Map();
for (const n of tree.nodes) {
  for (const p of n.parent_ids) {
    if (!ids.has(p) && p) errors.push(`${n.id} parent missing: ${p}`);
    const list = kids.get(p) ?? [];
    list.push(n.id);
    kids.set(p, list);
  }
}

const visiting = new Set();
const done = new Set();
const walk = (id) => {
  if (done.has(id)) return;
  if (visiting.has(id)) {
    errors.push(`cycle at ${id}`);
    return;
  }
  visiting.add(id);
  for (const c of kids.get(id) ?? []) walk(c);
  visiting.delete(id);
  done.add(id);
};
for (const n of tree.nodes) walk(n.id);

const left = tree.nodes.filter((n) => n.laterality === "left");
const right = tree.nodes.filter((n) => n.laterality === "right");
for (const n of left) {
  if (right.some((r) => r.id === n.id)) errors.push(`left/right share id ${n.id}`);
}

const unavailable = tree.nodes.filter((n) => n.mesh_status === "unavailable");
if (unavailable.length === 0) errors.push("unavailable nodes were dropped");
for (const n of unavailable) {
  if (!n.focus_fallback_id || !ids.has(n.focus_fallback_id)) errors.push(`${n.id} missing focus_fallback_id`);
}

for (const [asset, e] of Object.entries(manifest)) {
  if (!e.anatomy_id) errors.push(`${asset} missing anatomy_id`);
  if (!Array.isArray(e.camera_anchor) || e.camera_anchor.length !== 3) errors.push(`${asset} camera_anchor`);
  if (!e.bounds?.min || !e.bounds?.max) errors.push(`${asset} bounds`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ok: ${tree.nodes.length} nodes, ${Object.keys(manifest).length} assets, ${unavailable.length} unavailable kept`);
