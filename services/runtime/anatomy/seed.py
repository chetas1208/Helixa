"""Curated V14 anatomy tree. IDs match Agent 1's atlas so the UI and API interoperate.

OLS4 verification happens in scripts/v14_ingest_sources.py. Unverified CURIEs are
rewritten to DIAMOND: with ontology_status=unmapped. Lateral composites (@left/@right)
are used only when Uberon has no dedicated lateral class (checked at ingest).
"""

from __future__ import annotations

from typing import Any

# Agent 1 interop ids (apps/web/src/features/anatomy/ids.ts)
BODY = "UBERON:0013702"
HEAD = "UBERON:0000033"
FACE = "DIAMOND:region-head-face"
NECK = "UBERON:0000974"
THORAX = "UBERON:0000915"
ABDOMEN = "UBERON:0000916"
PELVIS = "UBERON:0002355"
SPINE = "UBERON:0001130"
ARM_L = "UBERON:0002102@left"
ARM_R = "UBERON:0002102@right"
SHOULDER_L = "UBERON:0001467@left"
SHOULDER_R = "UBERON:0001467@right"
HAND_L = "UBERON:0002398@left"
HAND_R = "UBERON:0002398@right"
LEG_L = "UBERON:0002103@left"
LEG_R = "UBERON:0002103@right"
FOOT_L = "UBERON:0002387@left"
FOOT_R = "UBERON:0002387@right"
BRAIN = "UBERON:0000955"
EYE_L = "UBERON:0004548"
EYE_R = "UBERON:0004549"
HEART = "UBERON:0000948"
LUNG_L = "UBERON:0002168"
LUNG_R = "UBERON:0002167"
LIVER = "UBERON:0002107"
STOMACH = "UBERON:0000945"
KIDNEY_L = "UBERON:0004538"
KIDNEY_R = "UBERON:0004539"
BLADDER = "UBERON:0001255"
PANCREAS = "UBERON:0001264"
SKIN = "UBERON:0002097"
TISSUE_MUSCLE = "UBERON:0001134"
TISSUE_BONE = "UBERON:0002481"
TISSUE_NERVE = "UBERON:0003714"
TISSUE_CONNECTIVE = "UBERON:0002384"

SYS = {
    "msk": "system:musculoskeletal",
    "nerv": "system:nervous",
    "card": "system:cardiovascular",
    "resp": "system:respiratory",
    "dig": "system:digestive",
    "ren": "system:urinary",
    "end": "system:endocrine",
    "rep": "system:reproductive",
    "int": "system:integumentary",
    "sen": "system:sensory",
}

SKIN_CTX = [SKIN, TISSUE_MUSCLE, TISSUE_BONE]
VISCERA = [TISSUE_CONNECTIVE]


def _node(
    id: str,
    label: str,
    *,
    ontology_id: str | None,
    type: str,
    parent_ids: list[str],
    system_ids: list[str],
    laterality: str,
    level: str,
    mesh_status: str,
    asset: str | None = None,
    synonyms: list[str] | None = None,
    tissue: list[str] | None = None,
    focus_fallback_id: str | None = None,
    description: str | None = None,
    ontology_status: str | None = None,
) -> dict[str, Any]:
    diamond = id.startswith("DIAMOND:")
    return {
        "id": id,
        "ontology_id": ontology_id,
        "ontology_status": ontology_status or ("unmapped" if diamond else "verified"),
        "label": label,
        "ontology_label": None,
        "synonyms": synonyms or [],
        "type": type,
        "parent_ids": parent_ids,
        "system_ids": system_ids,
        "laterality": laterality,
        "level": level,
        "asset_ids": [asset] if asset else [],
        "mesh_status": mesh_status,
        "focus_fallback_id": focus_fallback_id,
        "tissue_context_ids": tissue if tissue is not None else (VISCERA if type == "organ" else SKIN_CTX),
        "description": description,
    }


SEED_NODES: list[dict[str, Any]] = [
    _node(BODY, "Body", ontology_id="UBERON:0013702", type="region", parent_ids=[], system_ids=[SYS["msk"], SYS["int"]], laterality="midline", level="A", mesh_status="modeled", asset="mesh:body", synonyms=["whole body", "adult body", "body proper"], description="Generic adult body proper. Illustrative procedural figure, not a patient scan."),
    _node(HEAD, "Head", ontology_id="UBERON:0000033", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="modeled", asset="mesh:head", synonyms=["cranium", "skull region"]),
    _node(FACE, "Face", ontology_id=None, type="region", parent_ids=[HEAD], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="approximate", asset="mesh:face", synonyms=["visage", "face"], description="Front of the head. Uberon has UBERON:0001456 (face); Agent 1 bound the mesh to this DIAMOND id, so the API keeps it for interop."),
    _node(NECK, "Neck", ontology_id="UBERON:0000974", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="modeled", asset="mesh:neck", synonyms=["cervical region"]),
    _node(THORAX, "Thorax", ontology_id="UBERON:0000915", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="modeled", asset="mesh:thorax", synonyms=["chest", "rib cage", "thorax"]),
    _node(ABDOMEN, "Abdomen", ontology_id="UBERON:0000916", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="modeled", asset="mesh:abdomen", synonyms=["belly", "stomach region"]),
    _node(PELVIS, "Pelvis", ontology_id="UBERON:0002355", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="modeled", asset="mesh:pelvis", synonyms=["pelvic region", "hips"]),
    _node(SPINE, "Back / spine", ontology_id="UBERON:0001130", type="bone", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="midline", level="A", mesh_status="approximate", asset="mesh:spine", synonyms=["spine", "back", "vertebral column", "dorsum"]),
    _node(ARM_L, "Left arm", ontology_id="UBERON:0002102", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="left", level="A", mesh_status="modeled", asset="mesh:arm_L", synonyms=["left arm", "left upper limb", "left forelimb"]),
    _node(ARM_R, "Right arm", ontology_id="UBERON:0002102", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="right", level="A", mesh_status="modeled", asset="mesh:arm_R", synonyms=["right arm", "right upper limb", "right forelimb"]),
    _node(SHOULDER_L, "Left shoulder", ontology_id="UBERON:0001467", type="region", parent_ids=[ARM_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:shoulder_L", synonyms=["left shoulder"]),
    _node(SHOULDER_R, "Right shoulder", ontology_id="UBERON:0001467", type="region", parent_ids=[ARM_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:shoulder_R", synonyms=["right shoulder"]),
    _node("UBERON:0003822@left", "Left upper arm", ontology_id="UBERON:0003822", type="region", parent_ids=[ARM_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="unavailable", focus_fallback_id=ARM_L, synonyms=["left upper arm", "left brachium", "left forelimb stylopod"]),
    _node("UBERON:0003822@right", "Right upper arm", ontology_id="UBERON:0003822", type="region", parent_ids=[ARM_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="unavailable", focus_fallback_id=ARM_R, synonyms=["right upper arm", "right brachium", "right forelimb stylopod"]),
    _node("UBERON:0002386@left", "Left forearm", ontology_id="UBERON:0002386", type="region", parent_ids=[ARM_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="unavailable", focus_fallback_id=ARM_L, synonyms=["left forearm", "left forelimb zeugopod"]),
    _node("UBERON:0002386@right", "Right forearm", ontology_id="UBERON:0002386", type="region", parent_ids=[ARM_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="unavailable", focus_fallback_id=ARM_R, synonyms=["right forearm", "right forelimb zeugopod"]),
    _node(HAND_L, "Left hand", ontology_id="UBERON:0002398", type="region", parent_ids=[ARM_L], system_ids=[SYS["msk"]], laterality="left", level="A", mesh_status="modeled", asset="mesh:hand_L", synonyms=["left hand", "left palm", "manus", "hand"]),
    _node(HAND_R, "Right hand", ontology_id="UBERON:0002398", type="region", parent_ids=[ARM_R], system_ids=[SYS["msk"]], laterality="right", level="A", mesh_status="modeled", asset="mesh:hand_R", synonyms=["right hand", "right palm", "manus"]),
    _node(LEG_L, "Left leg", ontology_id="UBERON:0002103", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="left", level="A", mesh_status="modeled", asset="mesh:leg_L", synonyms=["left leg", "left lower limb", "left hindlimb"]),
    _node(LEG_R, "Right leg", ontology_id="UBERON:0002103", type="region", parent_ids=[BODY], system_ids=[SYS["msk"]], laterality="right", level="A", mesh_status="modeled", asset="mesh:leg_R", synonyms=["right leg", "right lower limb", "right hindlimb"]),
    _node("UBERON:0000376@left", "Left thigh", ontology_id="UBERON:0000376", type="region", parent_ids=[LEG_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="unavailable", focus_fallback_id=LEG_L, synonyms=["left thigh", "left hindlimb stylopod"]),
    _node("UBERON:0000376@right", "Right thigh", ontology_id="UBERON:0000376", type="region", parent_ids=[LEG_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="unavailable", focus_fallback_id=LEG_R, synonyms=["right thigh", "right hindlimb stylopod"]),
    _node("UBERON:0003823@left", "Left lower leg", ontology_id="UBERON:0003823", type="region", parent_ids=[LEG_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="unavailable", focus_fallback_id=LEG_L, synonyms=["left lower leg", "left crus", "left shin"]),
    _node("UBERON:0003823@right", "Right lower leg", ontology_id="UBERON:0003823", type="region", parent_ids=[LEG_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="unavailable", focus_fallback_id=LEG_R, synonyms=["right lower leg", "right crus", "right shin"]),
    _node(FOOT_L, "Left foot", ontology_id="UBERON:0002387", type="region", parent_ids=[LEG_L], system_ids=[SYS["msk"]], laterality="left", level="A", mesh_status="modeled", asset="mesh:foot_L", synonyms=["left foot", "pes"]),
    _node(FOOT_R, "Right foot", ontology_id="UBERON:0002387", type="region", parent_ids=[LEG_R], system_ids=[SYS["msk"]], laterality="right", level="A", mesh_status="modeled", asset="mesh:foot_R", synonyms=["right foot", "pes"]),
    _node(BRAIN, "Brain", ontology_id="UBERON:0000955", type="organ", parent_ids=[HEAD], system_ids=[SYS["nerv"]], laterality="midline", level="B", mesh_status="approximate", asset="mesh:brain", synonyms=["encephalon"], tissue=[TISSUE_NERVE]),
    _node(EYE_L, "Left eye", ontology_id="UBERON:0004548", type="organ", parent_ids=[FACE], system_ids=[SYS["sen"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:eye_L", synonyms=["left eye"]),
    _node(EYE_R, "Right eye", ontology_id="UBERON:0004549", type="organ", parent_ids=[FACE], system_ids=[SYS["sen"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:eye_R", synonyms=["right eye"]),
    _node("UBERON:0035295", "Left ear", ontology_id="UBERON:0035295", type="organ", parent_ids=[HEAD], system_ids=[SYS["sen"]], laterality="left", level="B", mesh_status="unavailable", focus_fallback_id=HEAD, synonyms=["left ear"]),
    _node("UBERON:0035174", "Right ear", ontology_id="UBERON:0035174", type="organ", parent_ids=[HEAD], system_ids=[SYS["sen"]], laterality="right", level="B", mesh_status="unavailable", focus_fallback_id=HEAD, synonyms=["right ear"]),
    _node("UBERON:0000004", "Nose", ontology_id="UBERON:0000004", type="organ", parent_ids=[FACE], system_ids=[SYS["resp"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=FACE, synonyms=["nose", "nasal organ"]),
    _node("UBERON:0000165", "Mouth", ontology_id="UBERON:0000165", type="organ", parent_ids=[FACE], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=FACE, synonyms=["mouth", "oral opening"]),
    _node(HEART, "Heart", ontology_id="UBERON:0000948", type="organ", parent_ids=[THORAX], system_ids=[SYS["card"]], laterality="midline", level="B", mesh_status="approximate", asset="mesh:heart", synonyms=["cardiac organ"], tissue=["UBERON:0001133", TISSUE_CONNECTIVE]),
    _node(LUNG_L, "Left lung", ontology_id="UBERON:0002168", type="organ", parent_ids=[THORAX], system_ids=[SYS["resp"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:lung_L", synonyms=["left lung"]),
    _node(LUNG_R, "Right lung", ontology_id="UBERON:0002167", type="organ", parent_ids=[THORAX], system_ids=[SYS["resp"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:lung_R", synonyms=["right lung"]),
    _node(LIVER, "Liver", ontology_id="UBERON:0002107", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="approximate", asset="mesh:liver", synonyms=["hepatic organ"]),
    _node(STOMACH, "Stomach", ontology_id="UBERON:0000945", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="approximate", asset="mesh:stomach", synonyms=["gaster"]),
    _node(PANCREAS, "Pancreas", ontology_id="UBERON:0001264", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["dig"], SYS["end"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=ABDOMEN, synonyms=["pancreas"]),
    _node(KIDNEY_L, "Left kidney", ontology_id="UBERON:0004538", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["ren"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:kidney_L", synonyms=["left kidney"]),
    _node(KIDNEY_R, "Right kidney", ontology_id="UBERON:0004539", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["ren"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:kidney_R", synonyms=["right kidney"]),
    _node(BLADDER, "Bladder", ontology_id="UBERON:0001255", type="organ", parent_ids=[PELVIS], system_ids=[SYS["ren"]], laterality="midline", level="B", mesh_status="approximate", asset="mesh:bladder", synonyms=["urinary bladder"]),
    _node("DIAMOND:digit-thumb@left", "Left thumb", ontology_id=None, type="region", parent_ids=[HAND_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:digit_L_1", synonyms=["left thumb", "digit 1"]),
    _node("DIAMOND:digit-index@left", "Left index finger", ontology_id=None, type="region", parent_ids=[HAND_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:digit_L_2", synonyms=["left index"]),
    _node("DIAMOND:digit-middle@left", "Left middle finger", ontology_id=None, type="region", parent_ids=[HAND_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:digit_L_3", synonyms=["left middle"]),
    _node("DIAMOND:digit-ring@left", "Left ring finger", ontology_id=None, type="region", parent_ids=[HAND_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:digit_L_4", synonyms=["left ring"]),
    _node("DIAMOND:digit-little@left", "Left little finger", ontology_id=None, type="region", parent_ids=[HAND_L], system_ids=[SYS["msk"]], laterality="left", level="B", mesh_status="approximate", asset="mesh:digit_L_5", synonyms=["left pinky", "left little finger"]),
    _node("DIAMOND:digit-thumb@right", "Right thumb", ontology_id=None, type="region", parent_ids=[HAND_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:digit_R_1", synonyms=["right thumb"]),
    _node("DIAMOND:digit-index@right", "Right index finger", ontology_id=None, type="region", parent_ids=[HAND_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:digit_R_2", synonyms=["right index"]),
    _node("DIAMOND:digit-middle@right", "Right middle finger", ontology_id=None, type="region", parent_ids=[HAND_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:digit_R_3", synonyms=["right middle"]),
    _node("DIAMOND:digit-ring@right", "Right ring finger", ontology_id=None, type="region", parent_ids=[HAND_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:digit_R_4", synonyms=["right ring"]),
    _node("DIAMOND:digit-little@right", "Right little finger", ontology_id=None, type="region", parent_ids=[HAND_R], system_ids=[SYS["msk"]], laterality="right", level="B", mesh_status="approximate", asset="mesh:digit_R_5", synonyms=["right pinky"]),
    _node("UBERON:0002106", "Spleen", ontology_id="UBERON:0002106", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["card"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=ABDOMEN, synonyms=["spleen"]),
    _node("UBERON:0002108", "Small intestine", ontology_id="UBERON:0002108", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=ABDOMEN, synonyms=["small bowel"]),
    _node("UBERON:0000059", "Large intestine", ontology_id="UBERON:0000059", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=ABDOMEN, synonyms=["colon"]),
    _node("UBERON:0002110", "Gallbladder", ontology_id="UBERON:0002110", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=LIVER, synonyms=["gall bladder"]),
    _node("UBERON:0002046", "Thyroid", ontology_id="UBERON:0002046", type="gland", parent_ids=[NECK], system_ids=[SYS["end"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=NECK, synonyms=["thyroid gland"]),
    _node("UBERON:0001737", "Larynx", ontology_id="UBERON:0001737", type="organ", parent_ids=[NECK], system_ids=[SYS["resp"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=NECK, synonyms=["voice box"]),
    _node("UBERON:0001043", "Oesophagus", ontology_id="UBERON:0001043", type="organ", parent_ids=[THORAX], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=THORAX, synonyms=["esophagus"]),
    _node("UBERON:0000947", "Aorta", ontology_id="UBERON:0000947", type="vessel", parent_ids=[THORAX], system_ids=[SYS["card"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=HEART, synonyms=["aorta"]),
    _node("UBERON:0001723", "Tongue", ontology_id="UBERON:0001723", type="organ", parent_ids=[HEAD], system_ids=[SYS["dig"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=FACE, synonyms=["tongue"]),
    _node("UBERON:0002240", "Spinal cord", ontology_id="UBERON:0002240", type="organ", parent_ids=[SPINE], system_ids=[SYS["nerv"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=SPINE, synonyms=["spinal cord"], tissue=[TISSUE_NERVE]),
    _node("UBERON:0001235", "Adrenal gland", ontology_id="UBERON:0001235", type="gland", parent_ids=[ABDOMEN], system_ids=[SYS["end"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=ABDOMEN, synonyms=["suprarenal gland"]),
    _node("UBERON:0000995", "Uterus", ontology_id="UBERON:0000995", type="organ", parent_ids=[PELVIS], system_ids=[SYS["rep"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=PELVIS, synonyms=["womb"]),
    _node("UBERON:0002367", "Prostate", ontology_id="UBERON:0002367", type="gland", parent_ids=[PELVIS], system_ids=[SYS["rep"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=PELVIS, synonyms=["prostate gland"]),
    _node(SKIN, "Skin", ontology_id="UBERON:0002097", type="tissue", parent_ids=[BODY], system_ids=[SYS["int"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=BODY, synonyms=["integument", "skin of body"], tissue=[SKIN]),
    _node(TISSUE_MUSCLE, "Skeletal muscle tissue", ontology_id="UBERON:0001134", type="tissue", parent_ids=[], system_ids=[SYS["msk"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=BODY, synonyms=["skeletal muscle", "striated muscle tissue"], tissue=[TISSUE_MUSCLE]),
    _node(TISSUE_BONE, "Bone tissue", ontology_id="UBERON:0002481", type="tissue", parent_ids=[], system_ids=[SYS["msk"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=BODY, synonyms=["bone", "osseous tissue"], tissue=[TISSUE_BONE]),
    _node(TISSUE_NERVE, "Neural tissue", ontology_id="UBERON:0003714", type="tissue", parent_ids=[], system_ids=[SYS["nerv"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=BRAIN, synonyms=["nervous tissue", "neural tissue"], tissue=[TISSUE_NERVE]),
    _node(TISSUE_CONNECTIVE, "Connective tissue", ontology_id="UBERON:0002384", type="tissue", parent_ids=[], system_ids=[SYS["msk"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=BODY, synonyms=["connective tissue"], tissue=[TISSUE_CONNECTIVE]),
    _node("UBERON:0001133", "Cardiac muscle tissue", ontology_id="UBERON:0001133", type="tissue", parent_ids=[], system_ids=[SYS["card"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=HEART, synonyms=["heart muscle", "cardiac muscle", "myocardium tissue"], tissue=["UBERON:0001133"]),
    _node("UBERON:0001013", "Adipose tissue", ontology_id="UBERON:0001013", type="tissue", parent_ids=[], system_ids=[SYS["int"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=BODY, synonyms=["fat tissue", "adipose"], tissue=["UBERON:0001013"]),
    _node("UBERON:0001981", "Blood vessel", ontology_id="UBERON:0001981", type="vessel", parent_ids=[], system_ids=[SYS["card"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=HEART, synonyms=["vessel", "blood vessel"], tissue=["UBERON:0001981"]),
    _node("UBERON:0002098", "Apex of heart", ontology_id="UBERON:0002098", type="organ", parent_ids=[HEART], system_ids=[SYS["card"]], laterality="midline", level="B", mesh_status="unavailable", focus_fallback_id=HEART, synonyms=["cardiac apex"], tissue=["UBERON:0001133"]),
    _node("UBERON:0002048", "Lung", ontology_id="UBERON:0002048", type="organ", parent_ids=[THORAX], system_ids=[SYS["resp"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=THORAX, synonyms=["lung", "pulmonary organ"]),
    _node("UBERON:0002113", "Kidney", ontology_id="UBERON:0002113", type="organ", parent_ids=[ABDOMEN], system_ids=[SYS["ren"]], laterality="none", level="C", mesh_status="unavailable", focus_fallback_id=ABDOMEN, synonyms=["kidney"]),
    _node("UBERON:0000956", "Cerebral cortex", ontology_id="UBERON:0000956", type="organ", parent_ids=[BRAIN], system_ids=[SYS["nerv"]], laterality="midline", level="C", mesh_status="unavailable", focus_fallback_id=BRAIN, synonyms=["brain cortex", "cortex"], tissue=[TISSUE_NERVE]),
]


SEED_SYSTEMS: list[dict[str, Any]] = [
    {"id": SYS["msk"], "label": "Musculoskeletal", "ontology_id": "UBERON:0002204"},
    {"id": SYS["nerv"], "label": "Nervous", "ontology_id": "UBERON:0001016"},
    {"id": SYS["card"], "label": "Cardiovascular", "ontology_id": "UBERON:0004535"},
    {"id": SYS["resp"], "label": "Respiratory", "ontology_id": "UBERON:0001004"},
    {"id": SYS["dig"], "label": "Digestive", "ontology_id": "UBERON:0001007"},
    {"id": SYS["ren"], "label": "Urinary", "ontology_id": "UBERON:0001008"},
    {"id": SYS["end"], "label": "Endocrine", "ontology_id": "UBERON:0000949"},
    {"id": SYS["rep"], "label": "Reproductive", "ontology_id": "UBERON:0000990"},
    {"id": SYS["int"], "label": "Integumentary", "ontology_id": "UBERON:0002416"},
    {"id": SYS["sen"], "label": "Sensory", "ontology_id": "UBERON:0001032"},
]


PANEL_SYMBOLS = ["MYH7", "PAX6", "COL1A1", "CFTR", "HBB", "TYR", "BDNF", "ACTN3"]

# Preferred ≤1000 bp GRCh38 windows (1-based inclusive, forward strand).
# MYH7 matches the contract example.
SLICE_WINDOWS: dict[str, tuple[str, int, int]] = {
    "MYH7": ("14", 23412700, 23412939),
    "PAX6": ("11", 31784750, 31784989),
    "COL1A1": ("17", 50184080, 50184319),
    "CFTR": ("7", 117287100, 117287339),
    "HBB": ("11", 5225464, 5225703),
    "TYR": ("11", 89177875, 89178114),
    "BDNF": ("11", 27654893, 27655132),
    "ACTN3": ("11", 66546395, 66546634),
}

# HPA tissue display name → verified Uberon id (ingest confirms the CURIE).
HPA_TISSUE_MAP: dict[str, str] = {
    "heart muscle": "UBERON:0001133",
    "skeletal muscle": "UBERON:0001134",
    "tongue": "UBERON:0001723",
    "liver": "UBERON:0002107",
    "kidney": "UBERON:0002113",
    "lung": "UBERON:0002048",
    "stomach": "UBERON:0000945",
    "pancreas": "UBERON:0001264",
    "skin": "UBERON:0002097",
    "skin 1": "UBERON:0002097",
    "skin 2": "UBERON:0002097",
    "cerebral cortex": "UBERON:0000956",
    "adipose tissue": "UBERON:0001013",
    "urinary bladder": "UBERON:0001255",
    "thyroid gland": "UBERON:0002046",
    "spleen": "UBERON:0002106",
    "small intestine": "UBERON:0002108",
    "colon": "UBERON:0000059",
    "gallbladder": "UBERON:0002110",
    "esophagus": "UBERON:0001043",
    "prostate": "UBERON:0002367",
    "cervix": "UBERON:0000002",
    "ovary": "UBERON:0000992",
    "testis": "UBERON:0000473",
    "bone marrow": "UBERON:0002371",
    "lymph node": "UBERON:0000029",
    "hippocampus": "UBERON:0002305",
    "amygdala": "UBERON:0001876",
    "cerebellum": "UBERON:0002037",
    "retina": "UBERON:0000966",
}

# Extra measured Uberon → tree node ids (beyond exact/ancestor match).
BGEE_ANATOMY_MAP: dict[str, list[str]] = {
    "UBERON:0002098": [HEART],
    "UBERON:0001133": [HEART],
    "UBERON:0002048": [LUNG_L, LUNG_R, THORAX],
    "UBERON:0002113": [KIDNEY_L, KIDNEY_R],
    "UBERON:0000970": [EYE_L, EYE_R],
    "UBERON:0001812": [EYE_L, EYE_R, FACE],  # palpebral conjunctiva
    "UBERON:0000966": [EYE_L, EYE_R],  # retina
    "UBERON:0002037": [BRAIN],  # cerebellum
    "UBERON:0000956": [BRAIN],
    "UBERON:0000988": [BRAIN],  # pons
    "UBERON:0004720": [BRAIN],
    "UBERON:0003053": [BRAIN],
    "UBERON:0004023": [BRAIN],
    "UBERON:0001134": [ARM_L, ARM_R, LEG_L, LEG_R, BODY],
    "UBERON:0002097": [SKIN, BODY],
}

KNOWN_LATERAL_CLASSES = {
    "UBERON:0002168": "left",
    "UBERON:0002167": "right",
    "UBERON:0004538": "left",
    "UBERON:0004539": "right",
    "UBERON:0004548": "left",
    "UBERON:0004549": "right",
    "UBERON:0035295": "left",
    "UBERON:0035174": "right",
}


def unique_curies() -> list[str]:
    seen: list[str] = []
    for node in SEED_NODES:
        oid = node.get("ontology_id")
        if oid and oid not in seen:
            seen.append(oid)
        for tid in node.get("tissue_context_ids") or []:
            if tid not in seen:
                seen.append(tid)
    for sys in SEED_SYSTEMS:
        oid = sys.get("ontology_id")
        if oid and oid not in seen:
            seen.append(oid)
    for tid in HPA_TISSUE_MAP.values():
        if tid not in seen:
            seen.append(tid)
    for tid in BGEE_ANATOMY_MAP:
        if tid not in seen:
            seen.append(tid)
    return seen
