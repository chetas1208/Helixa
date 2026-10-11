import type { AnatomyLevel, AnatomyType, Laterality, MeshStatus, SourceRef } from "../../v14/contracts";

export type AnatomyQuality = "high" | "balanced" | "low";

export interface AnatomyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeshBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshManifestEntry {
  anatomy_id: string;
  parent_id: string | null;
  system_ids: string[];
  side: Laterality;
  camera_anchor: [number, number, number];
  bounds: MeshBounds;
  display_name: string;
  mesh_status: MeshStatus;
  focus_fallback_id?: string | null;
}

export type MeshManifest = Record<string, MeshManifestEntry>;

export interface CatalogNode {
  id: string;
  ontology_id: string | null;
  ontology_status: "verified" | "unmapped";
  label: string;
  ontology_label?: string | null;
  synonyms: string[];
  type: AnatomyType;
  parent_ids: string[];
  system_ids: string[];
  laterality: Laterality;
  level: AnatomyLevel;
  asset_ids: string[];
  mesh_status: MeshStatus;
  focus_fallback_id?: string | null;
  tissue_context_ids: string[];
  description?: string | null;
  source: SourceRef;
}

export interface CatalogSystem {
  id: string;
  label: string;
  ontology_id: string | null;
  member_ids: string[];
}

export interface LocalTreeFixture {
  nodes: CatalogNode[];
  systems: CatalogSystem[];
  root_id: string;
  fixture_label: "local atlas fixture";
  source_status: { source_id: string; status: "cached"; version: string; retrieved_at: string | null }[];
}

export interface SearchHit {
  result_type: "anatomy" | "system";
  id: string;
  label: string;
  matched: string;
  score: number;
  laterality?: Laterality | null;
}

export type PickRank = "region" | "organ" | "digit";

export interface LoftSection {
  c: [number, number, number];
  rx: number;
  rz: number;
}

export type HitShape =
  | { kind: "loft"; sections: LoftSection[]; cap?: number }
  | { kind: "ellipsoid"; center: [number, number, number]; radii: [number, number, number] };

export interface HitDef {
  asset_id: string;
  anatomy_id: string;
  pickRank: PickRank;
  shape: HitShape;
}

export interface ClickMapRow {
  hotspot: string;
  asset_id: string;
  anatomy_id: string;
  side: Laterality;
  counterpart_id: string | null;
}

export interface QualityPreset {
  radial: number;
  perSegment: number;
  cap: number;
  particles: number;
  organRadial: number;
}
