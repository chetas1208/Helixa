/**
 * Curated adult-body atlas (Level A + representative Level B). Original catalog — not a mesh import.
 * Manifest JSON is a snapshot of `buildManifest()`; the local tree JSON is a snapshot of `buildLocalTree()`.
 */
import type { SourceRef } from "../../v14/contracts";
import {
  ABDOMEN, ADRENAL, AORTA, ARM_L, ARM_R, BLADDER, BODY, BRAIN, DIGIT_INDEX_L, DIGIT_INDEX_R, DIGIT_LITTLE_L,
  DIGIT_LITTLE_R, DIGIT_MIDDLE_L, DIGIT_MIDDLE_R, DIGIT_RING_L, DIGIT_RING_R, DIGIT_THUMB_L, DIGIT_THUMB_R,
  ESOPHAGUS, EYE_L, EYE_R, FACE, FOOT_L, FOOT_R, GALLBLADDER, HAND_L, HAND_R, HEAD, HEART, KIDNEY_L, KIDNEY_R,
  LARGE_INTESTINE, LARYNX, LEG_L, LEG_R, LIVER, LUNG_L, LUNG_R, NECK, PANCREAS, PELVIS, PROSTATE, SHOULDER_L,
  SHOULDER_R, SKIN, SMALL_INTESTINE, SPINAL_CORD, SPINE, SPLEEN, STOMACH, SYS_CARD, SYS_DIG, SYS_END, SYS_INT,
  SYS_MSK, SYS_NERV, SYS_REN, SYS_REP, SYS_RESP, SYS_SEN, THORAX, THYROID, TISSUE_BONE, TISSUE_CONNECTIVE,
  TISSUE_MUSCLE, TISSUE_NERVE, TISSUE_SKIN, TONGUE, UTERUS,
} from "./ids";
import { HIT_BY_ASSET, HIT_DEFS, anchorOfShape, boundsOfShape } from "./hitTable";
import type { CatalogNode, CatalogSystem, LocalTreeFixture, MeshManifest, MeshManifestEntry } from "./types";

const OLS = (id: string): SourceRef => {
  const iri = `http://purl.obolibrary.org/obo/${id.replace(":", "_").replace(/@.*$/, "")}`;
  return {
    name: "Uberon via OLS4",
    version: "client-catalog-v14; Agent 2 re-verifies at ingest",
    url: `https://www.ebi.ac.uk/ols4/ontologies/uberon/classes/${encodeURIComponent(iri)}`,
  };
};
const LOCAL: SourceRef = {
  name: "HELIXA local atlas fixture",
  version: "v14-agent1",
  url: "https://github.com/EBISPOT/uberon",
};

const MSK = [SYS_MSK];
const SKIN_CTX = [TISSUE_SKIN, TISSUE_MUSCLE, TISSUE_BONE];
const VISCERA = [TISSUE_CONNECTIVE];

type Draft = Omit<CatalogNode, "source" | "synonyms" | "tissue_context_ids" | "asset_ids"> & {
  asset?: string;
  synonyms?: string[];
  tissue?: string[];
};

function node(d: Draft): CatalogNode {
  const diamond = d.id.startsWith("DIAMOND:");
  return {
    id: d.id,
    ontology_id: d.ontology_id,
    ontology_status: d.ontology_status,
    label: d.label,
    ontology_label: d.ontology_label ?? null,
    synonyms: d.synonyms ?? [],
    type: d.type,
    parent_ids: d.parent_ids,
    system_ids: d.system_ids,
    laterality: d.laterality,
    level: d.level,
    asset_ids: d.asset ? [d.asset] : [],
    mesh_status: d.mesh_status,
    focus_fallback_id: d.focus_fallback_id ?? null,
    tissue_context_ids: d.tissue ?? (d.type === "organ" ? VISCERA : SKIN_CTX),
    description: d.description ?? null,
    source: diamond ? LOCAL : OLS(d.ontology_id ?? d.id),
  };
}

export const ATLAS_NODES: CatalogNode[] = [
  node({ id: BODY, ontology_id: "UBERON:0013702", ontology_status: "verified", label: "Body", ontology_label: "body proper", type: "region", parent_ids: [], system_ids: [SYS_MSK, SYS_INT], laterality: "midline", level: "A", mesh_status: "modeled", asset: "mesh:body", synonyms: ["whole body", "adult body"], description: "Generic adult body proper. Illustrative procedural figure, not a patient scan." }),
  node({ id: HEAD, ontology_id: "UBERON:0000033", ontology_status: "verified", label: "Head", ontology_label: "head", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "modeled", asset: "mesh:head", synonyms: ["cranium", "skull region"] }),
  node({ id: FACE, ontology_id: null, ontology_status: "unmapped", label: "Face", type: "region", parent_ids: [HEAD], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "approximate", asset: "mesh:face", synonyms: ["visage"], description: "Front of the head. No verified Uberon lateral class used; stored as DIAMOND: per contract." }),
  node({ id: NECK, ontology_id: "UBERON:0000974", ontology_status: "verified", label: "Neck", ontology_label: "neck", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "modeled", asset: "mesh:neck", synonyms: ["cervical region"] }),
  node({ id: THORAX, ontology_id: "UBERON:0000915", ontology_status: "verified", label: "Thorax", ontology_label: "thorax", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "modeled", asset: "mesh:thorax", synonyms: ["chest", "rib cage"] }),
  node({ id: ABDOMEN, ontology_id: "UBERON:0000916", ontology_status: "verified", label: "Abdomen", ontology_label: "abdomen", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "modeled", asset: "mesh:abdomen", synonyms: ["belly", "stomach region"] }),
  node({ id: PELVIS, ontology_id: "UBERON:0002355", ontology_status: "verified", label: "Pelvis", ontology_label: "pelvic region", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "modeled", asset: "mesh:pelvis", synonyms: ["pelvic region", "hips"] }),
  node({ id: SPINE, ontology_id: "UBERON:0001130", ontology_status: "verified", label: "Back / spine", ontology_label: "vertebral column", type: "bone", parent_ids: [BODY], system_ids: MSK, laterality: "midline", level: "A", mesh_status: "approximate", asset: "mesh:spine", synonyms: ["spine", "back", "vertebral column"] }),
  node({ id: ARM_L, ontology_id: "UBERON:0002102", ontology_status: "verified", label: "Left arm", ontology_label: "forelimb", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "left", level: "A", mesh_status: "modeled", asset: "mesh:arm_L", synonyms: ["left arm", "left upper limb"] }),
  node({ id: ARM_R, ontology_id: "UBERON:0002102", ontology_status: "verified", label: "Right arm", ontology_label: "forelimb", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "right", level: "A", mesh_status: "modeled", asset: "mesh:arm_R", synonyms: ["right arm", "right upper limb"] }),
  node({ id: SHOULDER_L, ontology_id: "UBERON:0001467", ontology_status: "verified", label: "Left shoulder", ontology_label: "pectoral girdle region", type: "region", parent_ids: [ARM_L], system_ids: MSK, laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:shoulder_L", synonyms: ["left shoulder"] }),
  node({ id: SHOULDER_R, ontology_id: "UBERON:0001467", ontology_status: "verified", label: "Right shoulder", ontology_label: "pectoral girdle region", type: "region", parent_ids: [ARM_R], system_ids: MSK, laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:shoulder_R", synonyms: ["right shoulder"] }),
  node({ id: HAND_L, ontology_id: "UBERON:0002398", ontology_status: "verified", label: "Left hand", ontology_label: "manus", type: "region", parent_ids: [ARM_L], system_ids: MSK, laterality: "left", level: "A", mesh_status: "modeled", asset: "mesh:hand_L", synonyms: ["left hand", "left palm", "manus"] }),
  node({ id: HAND_R, ontology_id: "UBERON:0002398", ontology_status: "verified", label: "Right hand", ontology_label: "manus", type: "region", parent_ids: [ARM_R], system_ids: MSK, laterality: "right", level: "A", mesh_status: "modeled", asset: "mesh:hand_R", synonyms: ["right hand", "right palm", "manus"] }),
  node({ id: LEG_L, ontology_id: "UBERON:0002103", ontology_status: "verified", label: "Left leg", ontology_label: "hindlimb", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "left", level: "A", mesh_status: "modeled", asset: "mesh:leg_L", synonyms: ["left leg", "left lower limb"] }),
  node({ id: LEG_R, ontology_id: "UBERON:0002103", ontology_status: "verified", label: "Right leg", ontology_label: "hindlimb", type: "region", parent_ids: [BODY], system_ids: MSK, laterality: "right", level: "A", mesh_status: "modeled", asset: "mesh:leg_R", synonyms: ["right leg", "right lower limb"] }),
  node({ id: FOOT_L, ontology_id: "UBERON:0002387", ontology_status: "verified", label: "Left foot", ontology_label: "pes", type: "region", parent_ids: [LEG_L], system_ids: MSK, laterality: "left", level: "A", mesh_status: "modeled", asset: "mesh:foot_L", synonyms: ["left foot", "pes"] }),
  node({ id: FOOT_R, ontology_id: "UBERON:0002387", ontology_status: "verified", label: "Right foot", ontology_label: "pes", type: "region", parent_ids: [LEG_R], system_ids: MSK, laterality: "right", level: "A", mesh_status: "modeled", asset: "mesh:foot_R", synonyms: ["right foot", "pes"] }),

  node({ id: BRAIN, ontology_id: "UBERON:0000955", ontology_status: "verified", label: "Brain", ontology_label: "brain", type: "organ", parent_ids: [HEAD], system_ids: [SYS_NERV], laterality: "midline", level: "B", mesh_status: "approximate", asset: "mesh:brain", synonyms: ["encephalon"], tissue: [TISSUE_NERVE] }),
  node({ id: EYE_L, ontology_id: "UBERON:0004548", ontology_status: "verified", label: "Left eye", ontology_label: "left eye", type: "organ", parent_ids: [FACE], system_ids: [SYS_SEN], laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:eye_L", synonyms: ["left eye"] }),
  node({ id: EYE_R, ontology_id: "UBERON:0004549", ontology_status: "verified", label: "Right eye", ontology_label: "right eye", type: "organ", parent_ids: [FACE], system_ids: [SYS_SEN], laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:eye_R", synonyms: ["right eye"] }),
  node({ id: HEART, ontology_id: "UBERON:0000948", ontology_status: "verified", label: "Heart", ontology_label: "heart", type: "organ", parent_ids: [THORAX], system_ids: [SYS_CARD], laterality: "midline", level: "B", mesh_status: "approximate", asset: "mesh:heart", synonyms: ["cardiac organ"] }),
  node({ id: LUNG_L, ontology_id: "UBERON:0002168", ontology_status: "verified", label: "Left lung", ontology_label: "left lung", type: "organ", parent_ids: [THORAX], system_ids: [SYS_RESP], laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:lung_L", synonyms: ["left lung"] }),
  node({ id: LUNG_R, ontology_id: "UBERON:0002167", ontology_status: "verified", label: "Right lung", ontology_label: "right lung", type: "organ", parent_ids: [THORAX], system_ids: [SYS_RESP], laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:lung_R", synonyms: ["right lung"] }),
  node({ id: LIVER, ontology_id: "UBERON:0002107", ontology_status: "verified", label: "Liver", ontology_label: "liver", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "approximate", asset: "mesh:liver", synonyms: ["hepatic organ"] }),
  node({ id: STOMACH, ontology_id: "UBERON:0000945", ontology_status: "verified", label: "Stomach", ontology_label: "stomach", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "approximate", asset: "mesh:stomach", synonyms: ["gaster"] }),
  node({ id: KIDNEY_L, ontology_id: "UBERON:0004538", ontology_status: "verified", label: "Left kidney", ontology_label: "left kidney", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_REN], laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:kidney_L", synonyms: ["left kidney"] }),
  node({ id: KIDNEY_R, ontology_id: "UBERON:0004539", ontology_status: "verified", label: "Right kidney", ontology_label: "right kidney", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_REN], laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:kidney_R", synonyms: ["right kidney"] }),
  node({ id: BLADDER, ontology_id: "UBERON:0001255", ontology_status: "verified", label: "Bladder", ontology_label: "urinary bladder", type: "organ", parent_ids: [PELVIS], system_ids: [SYS_REN], laterality: "midline", level: "B", mesh_status: "approximate", asset: "mesh:bladder", synonyms: ["urinary bladder"] }),

  node({ id: DIGIT_THUMB_L, ontology_id: null, ontology_status: "unmapped", label: "Left thumb", type: "region", parent_ids: [HAND_L], system_ids: MSK, laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:digit_L_1", synonyms: ["left thumb", "digit 1"] }),
  node({ id: DIGIT_INDEX_L, ontology_id: null, ontology_status: "unmapped", label: "Left index finger", type: "region", parent_ids: [HAND_L], system_ids: MSK, laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:digit_L_2", synonyms: ["left index"] }),
  node({ id: DIGIT_MIDDLE_L, ontology_id: null, ontology_status: "unmapped", label: "Left middle finger", type: "region", parent_ids: [HAND_L], system_ids: MSK, laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:digit_L_3", synonyms: ["left middle"] }),
  node({ id: DIGIT_RING_L, ontology_id: null, ontology_status: "unmapped", label: "Left ring finger", type: "region", parent_ids: [HAND_L], system_ids: MSK, laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:digit_L_4", synonyms: ["left ring"] }),
  node({ id: DIGIT_LITTLE_L, ontology_id: null, ontology_status: "unmapped", label: "Left little finger", type: "region", parent_ids: [HAND_L], system_ids: MSK, laterality: "left", level: "B", mesh_status: "approximate", asset: "mesh:digit_L_5", synonyms: ["left pinky"] }),
  node({ id: DIGIT_THUMB_R, ontology_id: null, ontology_status: "unmapped", label: "Right thumb", type: "region", parent_ids: [HAND_R], system_ids: MSK, laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:digit_R_1", synonyms: ["right thumb"] }),
  node({ id: DIGIT_INDEX_R, ontology_id: null, ontology_status: "unmapped", label: "Right index finger", type: "region", parent_ids: [HAND_R], system_ids: MSK, laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:digit_R_2", synonyms: ["right index"] }),
  node({ id: DIGIT_MIDDLE_R, ontology_id: null, ontology_status: "unmapped", label: "Right middle finger", type: "region", parent_ids: [HAND_R], system_ids: MSK, laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:digit_R_3", synonyms: ["right middle"] }),
  node({ id: DIGIT_RING_R, ontology_id: null, ontology_status: "unmapped", label: "Right ring finger", type: "region", parent_ids: [HAND_R], system_ids: MSK, laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:digit_R_4", synonyms: ["right ring"] }),
  node({ id: DIGIT_LITTLE_R, ontology_id: null, ontology_status: "unmapped", label: "Right little finger", type: "region", parent_ids: [HAND_R], system_ids: MSK, laterality: "right", level: "B", mesh_status: "approximate", asset: "mesh:digit_R_5", synonyms: ["right pinky"] }),

  node({ id: PANCREAS, ontology_id: "UBERON:0001264", ontology_status: "verified", label: "Pancreas", ontology_label: "pancreas", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_DIG, SYS_END], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: ABDOMEN, synonyms: ["pancreas"] }),
  node({ id: SPLEEN, ontology_id: "UBERON:0002106", ontology_status: "verified", label: "Spleen", ontology_label: "spleen", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_CARD], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: ABDOMEN, synonyms: ["spleen"] }),
  node({ id: SMALL_INTESTINE, ontology_id: "UBERON:0002108", ontology_status: "verified", label: "Small intestine", ontology_label: "small intestine", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: ABDOMEN, synonyms: ["small bowel"] }),
  node({ id: LARGE_INTESTINE, ontology_id: "UBERON:0000059", ontology_status: "verified", label: "Large intestine", ontology_label: "large intestine", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: ABDOMEN, synonyms: ["colon"] }),
  node({ id: GALLBLADDER, ontology_id: "UBERON:0002110", ontology_status: "verified", label: "Gallbladder", ontology_label: "gallbladder", type: "organ", parent_ids: [ABDOMEN], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: LIVER, synonyms: ["gall bladder"] }),
  node({ id: THYROID, ontology_id: "UBERON:0002046", ontology_status: "verified", label: "Thyroid", ontology_label: "thyroid gland", type: "gland", parent_ids: [NECK], system_ids: [SYS_END], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: NECK, synonyms: ["thyroid gland"] }),
  node({ id: LARYNX, ontology_id: "UBERON:0001737", ontology_status: "verified", label: "Larynx", ontology_label: "larynx", type: "organ", parent_ids: [NECK], system_ids: [SYS_RESP], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: NECK, synonyms: ["voice box"] }),
  node({ id: ESOPHAGUS, ontology_id: "UBERON:0001043", ontology_status: "verified", label: "Oesophagus", ontology_label: "esophagus", type: "organ", parent_ids: [THORAX], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: THORAX, synonyms: ["esophagus"] }),
  node({ id: AORTA, ontology_id: "UBERON:0000947", ontology_status: "verified", label: "Aorta", ontology_label: "aorta", type: "vessel", parent_ids: [THORAX], system_ids: [SYS_CARD], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: HEART, synonyms: ["aorta"] }),
  node({ id: TONGUE, ontology_id: "UBERON:0001723", ontology_status: "verified", label: "Tongue", ontology_label: "tongue", type: "organ", parent_ids: [HEAD], system_ids: [SYS_DIG], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: FACE, synonyms: ["tongue"] }),
  node({ id: SPINAL_CORD, ontology_id: "UBERON:0002240", ontology_status: "verified", label: "Spinal cord", ontology_label: "spinal cord", type: "organ", parent_ids: [SPINE], system_ids: [SYS_NERV], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: SPINE, synonyms: ["spinal cord"], tissue: [TISSUE_NERVE] }),
  node({ id: ADRENAL, ontology_id: "UBERON:0001235", ontology_status: "verified", label: "Adrenal gland", ontology_label: "adrenal gland", type: "gland", parent_ids: [ABDOMEN], system_ids: [SYS_END], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: ABDOMEN, synonyms: ["suprarenal gland"] }),
  node({ id: UTERUS, ontology_id: "UBERON:0000995", ontology_status: "verified", label: "Uterus", ontology_label: "uterus", type: "organ", parent_ids: [PELVIS], system_ids: [SYS_REP], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: PELVIS, synonyms: ["womb"] }),
  node({ id: PROSTATE, ontology_id: "UBERON:0002367", ontology_status: "verified", label: "Prostate", ontology_label: "prostate gland", type: "gland", parent_ids: [PELVIS], system_ids: [SYS_REP], laterality: "midline", level: "B", mesh_status: "unavailable", focus_fallback_id: PELVIS, synonyms: ["prostate gland"] }),
  node({ id: SKIN, ontology_id: "UBERON:0002097", ontology_status: "verified", label: "Skin", ontology_label: "skin of body", type: "tissue", parent_ids: [BODY], system_ids: [SYS_INT], laterality: "none", level: "C", mesh_status: "unavailable", focus_fallback_id: BODY, synonyms: ["integument", "skin of body"], tissue: [TISSUE_SKIN] }),
];

export const ATLAS_SYSTEMS: CatalogSystem[] = [
  { id: SYS_MSK, label: "Musculoskeletal", ontology_id: "UBERON:0002204", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_MSK)).map((n) => n.id) },
  { id: SYS_NERV, label: "Nervous", ontology_id: "UBERON:0001016", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_NERV)).map((n) => n.id) },
  { id: SYS_CARD, label: "Cardiovascular", ontology_id: "UBERON:0004535", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_CARD)).map((n) => n.id) },
  { id: SYS_RESP, label: "Respiratory", ontology_id: "UBERON:0001004", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_RESP)).map((n) => n.id) },
  { id: SYS_DIG, label: "Digestive", ontology_id: "UBERON:0001007", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_DIG)).map((n) => n.id) },
  { id: SYS_REN, label: "Urinary", ontology_id: "UBERON:0001008", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_REN)).map((n) => n.id) },
  { id: SYS_END, label: "Endocrine", ontology_id: "UBERON:0000949", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_END)).map((n) => n.id) },
  { id: SYS_REP, label: "Reproductive", ontology_id: "UBERON:0000990", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_REP)).map((n) => n.id) },
  { id: SYS_INT, label: "Integumentary", ontology_id: "UBERON:0002416", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_INT)).map((n) => n.id) },
  { id: SYS_SEN, label: "Sensory", ontology_id: "UBERON:0001032", member_ids: ATLAS_NODES.filter((n) => n.system_ids.includes(SYS_SEN)).map((n) => n.id) },
];

export const NODE_BY_ID = Object.fromEntries(ATLAS_NODES.map((n) => [n.id, n])) as Record<string, CatalogNode>;

function entryFor(assetId: string, nodeId: string): MeshManifestEntry {
  const n = NODE_BY_ID[nodeId];
  const hit = HIT_BY_ASSET[assetId];
  const bounds = hit ? boundsOfShape(hit.shape) : { min: [-0.2, -0.2, -0.2] as [number, number, number], max: [0.2, 0.2, 0.2] as [number, number, number] };
  const camera_anchor: [number, number, number] = hit ? anchorOfShape(hit.shape) : [0, 0, 0];
  return {
    anatomy_id: nodeId,
    parent_id: n.parent_ids[0] ?? null,
    system_ids: n.system_ids,
    side: n.laterality,
    camera_anchor,
    bounds,
    display_name: n.label,
    mesh_status: n.mesh_status,
    focus_fallback_id: n.focus_fallback_id ?? null,
  };
}

export function buildManifest(): MeshManifest {
  const out: MeshManifest = {};
  for (const n of ATLAS_NODES) {
    if (n.asset_ids[0]) out[n.asset_ids[0]] = entryFor(n.asset_ids[0], n.id);
    else if (n.mesh_status === "unavailable") {
      const fb = n.focus_fallback_id ? NODE_BY_ID[n.focus_fallback_id] : undefined;
      const fbHit = fb?.asset_ids[0] ? HIT_BY_ASSET[fb.asset_ids[0]] : undefined;
      out[`mesh:unavailable:${n.id}`] = {
        anatomy_id: n.id,
        parent_id: n.parent_ids[0] ?? null,
        system_ids: n.system_ids,
        side: n.laterality,
        camera_anchor: fbHit ? anchorOfShape(fbHit.shape) : ([0, 0, 0] as [number, number, number]),
        bounds: fbHit ? boundsOfShape(fbHit.shape) : { min: [-0.2, -0.2, -0.2] as [number, number, number], max: [0.2, 0.2, 0.2] as [number, number, number] },
        display_name: n.label,
        mesh_status: "unavailable",
        focus_fallback_id: n.focus_fallback_id ?? null,
      };
    }
  }
  return out;
}

export function buildLocalTree(): LocalTreeFixture {
  return {
    nodes: ATLAS_NODES,
    systems: ATLAS_SYSTEMS,
    root_id: BODY,
    fixture_label: "local atlas fixture",
    source_status: [{ source_id: "local-atlas-fixture", status: "cached", version: "v14-agent1", retrieved_at: null }],
  };
}

export function modeledAssetIds(): string[] {
  return HIT_DEFS.filter((h) => h.asset_id !== "mesh:body").map((h) => h.asset_id);
}

export function resolveFocusId(anatomyId: string | null): string | null {
  if (!anatomyId) return null;
  const n = NODE_BY_ID[anatomyId];
  if (!n) return anatomyId;
  if (n.mesh_status === "unavailable" && n.focus_fallback_id) return resolveFocusId(n.focus_fallback_id);
  return n.id;
}

export function manifestEntryForAnatomy(manifest: MeshManifest, anatomyId: string): MeshManifestEntry | undefined {
  return Object.values(manifest).find((e) => e.anatomy_id === anatomyId);
}
