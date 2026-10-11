import { describe, expect, it } from "vitest";
import { anatomyMeshManifest, buildLocalTree, buildManifest, CLICK_MAP, resolveFocusId } from "../../src/features/anatomy";
import { ATLAS_NODES, NODE_BY_ID } from "../../src/features/anatomy/catalog";
import { HIT_DEFS } from "../../src/features/anatomy/hitTable";
import {
  ABDOMEN, ARM_L, ARM_R, FACE, FOOT_L, FOOT_R, HAND_L, HAND_R, HEAD, HEART, LEG_L, LEG_R, LIVER, LUNG_L, LUNG_R,
  NECK, PANCREAS, PELVIS, SPINE, THORAX,
} from "../../src/features/anatomy/ids";
import { loftEllipses } from "../../src/features/anatomy/loft";
import { pointerToRectNdc, poseForBounds } from "../../src/features/anatomy/cameraMath";
import { findCycle, isAcyclic, unavailableNodes } from "../../src/features/anatomy/treeModel";
import type { CatalogNode } from "../../src/features/anatomy/types";

const CONTRACT_ID = /^(UBERON:\d{7}(@left|@right)?|DIAMOND:[A-Za-z0-9:@-]+)$/;

const LEVEL_A = [HEAD, FACE, NECK, THORAX, ABDOMEN, PELVIS, SPINE, ARM_L, ARM_R, HAND_L, HAND_R, LEG_L, LEG_R, FOOT_L, FOOT_R];

describe("anatomy laterality", () => {
  it("left hand and right hand use distinct contract ids", () => {
    expect(HAND_L).toBe("UBERON:0002398@left");
    expect(HAND_R).toBe("UBERON:0002398@right");
    expect(HAND_L).not.toBe(HAND_R);
  });

  it("every lateral pair in the click map has two different ids", () => {
    const paired = CLICK_MAP.filter((r) => r.counterpart_id);
    expect(paired.length).toBeGreaterThan(8);
    for (const row of paired) {
      expect(row.anatomy_id, row.hotspot).not.toBe(row.counterpart_id);
      expect(row.side === "left" || row.side === "right").toBe(true);
    }
  });

  it("left lung uses its own Uberon class, not @left on a shared id", () => {
    expect(LUNG_L).toBe("UBERON:0002168");
    expect(LUNG_R).toBe("UBERON:0002167");
    expect(LUNG_L).not.toBe(LUNG_R);
  });
});

describe("click mapping table", () => {
  it("maps every modeled hotspot to a contract anatomy_id", () => {
    expect(CLICK_MAP.length).toBeGreaterThan(20);
    for (const row of CLICK_MAP) {
      expect(row.anatomy_id, row.hotspot).toMatch(CONTRACT_ID);
      expect(NODE_BY_ID[row.anatomy_id], row.anatomy_id).toBeTruthy();
      const asset = anatomyMeshManifest[row.asset_id];
      expect(asset?.anatomy_id, row.asset_id).toBe(row.anatomy_id);
    }
  });

  it("covers required Level A exterior regions", () => {
    const ids = new Set(CLICK_MAP.map((r) => r.anatomy_id));
    for (const id of LEVEL_A) expect(ids.has(id), id).toBe(true);
  });

  it("includes representative Level B organs as pickable volumes", () => {
    const ids = new Set(CLICK_MAP.map((r) => r.anatomy_id));
    for (const id of [HEART, LIVER, LUNG_L, LUNG_R]) expect(ids.has(id), id).toBe(true);
  });
});

describe("manifest + local tree", () => {
  it("JSON manifest matches the catalog builder", () => {
    expect(anatomyMeshManifest).toEqual(buildManifest());
  });

  it("every modeled/approximate asset has bounds and a camera_anchor", () => {
    for (const [asset, e] of Object.entries(anatomyMeshManifest)) {
      expect(e.camera_anchor, asset).toHaveLength(3);
      expect(e.bounds.min, asset).toHaveLength(3);
      expect(e.bounds.max, asset).toHaveLength(3);
      expect(e.display_name, asset).toBeTruthy();
      expect(["modeled", "approximate", "unavailable"]).toContain(e.mesh_status);
    }
  });

  it("does not silently drop unavailable organs", () => {
    const tree = buildLocalTree();
    const missing = unavailableNodes(tree.nodes);
    expect(missing.map((n) => n.id)).toContain(PANCREAS);
    expect(missing.length).toBeGreaterThanOrEqual(8);
    for (const n of missing) {
      expect(n.focus_fallback_id, n.id).toBeTruthy();
      expect(NODE_BY_ID[n.focus_fallback_id!], n.id).toBeTruthy();
      const listed = Object.values(anatomyMeshManifest).some((e) => e.anatomy_id === n.id);
      expect(listed, `${n.id} must remain in the manifest`).toBe(true);
    }
  });

  it("parent/child of the local tree is acyclic", () => {
    const tree = buildLocalTree();
    expect(findCycle(tree.nodes)).toEqual([]);
    expect(isAcyclic(tree.nodes)).toBe(true);
    const broken: CatalogNode[] = [...ATLAS_NODES, { ...ATLAS_NODES[0], id: "DIAMOND:cycle", parent_ids: ["DIAMOND:cycle"], synonyms: [], tissue_context_ids: [], asset_ids: [], source: ATLAS_NODES[0].source }];
    expect(isAcyclic(broken)).toBe(false);
  });

  it("focus of an unavailable node walks to a modeled region", () => {
    expect(resolveFocusId(PANCREAS)).toBe(ABDOMEN);
    expect(resolveFocusId(HAND_L)).toBe(HAND_L);
    expect(resolveFocusId(null)).toBeNull();
  });
});

describe("hit volumes", () => {
  it("every hit (except the body envelope) is a named contract id", () => {
    for (const h of HIT_DEFS) {
      if (h.asset_id === "mesh:body") continue;
      expect(h.anatomy_id).toMatch(CONTRACT_ID);
    }
  });

  it("lofted volumes produce indexed geometry (node-safe)", () => {
    const g = loftEllipses(
      [
        { c: [0, 0, 0], rx: 0.2, rz: 0.2 },
        { c: [0, 1, 0], rx: 0.15, rz: 0.15 },
      ],
      { radial: 8, perSegment: 3, cap: 2 },
    );
    expect(g.getAttribute("position").count).toBeGreaterThan(16);
    expect(g.getIndex()?.count).toBeGreaterThan(16);
    g.dispose();
  });
});

describe("private camera math", () => {
  it("pointer outside the anatomy rect is ignored (helix stays untouched)", () => {
    const rect = { x: 10, y: 10, width: 100, height: 200 };
    expect(pointerToRectNdc(5, 20, rect)).toBeNull();
    expect(pointerToRectNdc(60, 110, rect)).toEqual([0, 0]);
  });

  it("focus pose looks at the part bounds, not a shared origin", () => {
    const hand = anatomyMeshManifest["mesh:hand_L"];
    const pose = poseForBounds(hand.bounds, 32, hand.camera_anchor);
    expect(pose.lookAt[0]).toBeGreaterThan(1);
    expect(pose.position[2]).toBeGreaterThan(pose.lookAt[2]);
  });
});
