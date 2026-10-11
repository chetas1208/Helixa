/**
 * Canonical anatomy ids used by the V14 atlas (contract §1).
 * Lateral pairs always differ: left hand ≠ right hand.
 * Uberon CURIEs below are textbook class ids; Agent 2 re-verifies them at OLS4 ingest.
 */
export const BODY = "UBERON:0013702";
export const HEAD = "UBERON:0000033";
export const FACE = "DIAMOND:region-head-face";
export const NECK = "UBERON:0000974";
export const THORAX = "UBERON:0000915";
export const ABDOMEN = "UBERON:0000916";
export const PELVIS = "UBERON:0002355";
export const SPINE = "UBERON:0001130";

export const ARM_L = "UBERON:0002102@left";
export const ARM_R = "UBERON:0002102@right";
export const HAND_L = "UBERON:0002398@left";
export const HAND_R = "UBERON:0002398@right";
export const LEG_L = "UBERON:0002103@left";
export const LEG_R = "UBERON:0002103@right";
export const FOOT_L = "UBERON:0002387@left";
export const FOOT_R = "UBERON:0002387@right";

export const BRAIN = "UBERON:0000955";
export const EYE_L = "UBERON:0004548";
export const EYE_R = "UBERON:0004549";
export const HEART = "UBERON:0000948";
export const LUNG_L = "UBERON:0002168";
export const LUNG_R = "UBERON:0002167";
export const LIVER = "UBERON:0002107";
export const STOMACH = "UBERON:0000945";
export const KIDNEY_L = "UBERON:0004538";
export const KIDNEY_R = "UBERON:0004539";
export const BLADDER = "UBERON:0001255";

export const DIGIT_THUMB_L = "DIAMOND:digit-thumb@left";
export const DIGIT_INDEX_L = "DIAMOND:digit-index@left";
export const DIGIT_MIDDLE_L = "DIAMOND:digit-middle@left";
export const DIGIT_RING_L = "DIAMOND:digit-ring@left";
export const DIGIT_LITTLE_L = "DIAMOND:digit-little@left";
export const DIGIT_THUMB_R = "DIAMOND:digit-thumb@right";
export const DIGIT_INDEX_R = "DIAMOND:digit-index@right";
export const DIGIT_MIDDLE_R = "DIAMOND:digit-middle@right";
export const DIGIT_RING_R = "DIAMOND:digit-ring@right";
export const DIGIT_LITTLE_R = "DIAMOND:digit-little@right";

export const SHOULDER_L = "UBERON:0001467@left";
export const SHOULDER_R = "UBERON:0001467@right";

export const PANCREAS = "UBERON:0001264";
export const SPLEEN = "UBERON:0002106";
export const SMALL_INTESTINE = "UBERON:0002108";
export const LARGE_INTESTINE = "UBERON:0000059";
export const THYROID = "UBERON:0002046";
export const GALLBLADDER = "UBERON:0002110";
export const UTERUS = "UBERON:0000995";
export const PROSTATE = "UBERON:0002367";
export const SPINAL_CORD = "UBERON:0002240";
export const AORTA = "UBERON:0000947";
export const TONGUE = "UBERON:0001723";
export const LARYNX = "UBERON:0001737";
export const ESOPHAGUS = "UBERON:0001043";
export const ADRENAL = "UBERON:0001235";
export const SKIN = "UBERON:0002097";

export const SYS_MSK = "system:musculoskeletal";
export const SYS_NERV = "system:nervous";
export const SYS_CARD = "system:cardiovascular";
export const SYS_RESP = "system:respiratory";
export const SYS_DIG = "system:digestive";
export const SYS_REN = "system:urinary";
export const SYS_END = "system:endocrine";
export const SYS_REP = "system:reproductive";
export const SYS_INT = "system:integumentary";
export const SYS_SEN = "system:sensory";

export const TISSUE_SKIN = "UBERON:0002097";
export const TISSUE_MUSCLE = "UBERON:0001134";
export const TISSUE_BONE = "UBERON:0002481";
export const TISSUE_NERVE = "UBERON:0003714";
export const TISSUE_CONNECTIVE = "UBERON:0002384";

/** Contract example laterality pair used by tests and the click map. */
export const CONTRACT_HAND_L = HAND_L;
export const CONTRACT_HAND_R = HAND_R;
export const CONTRACT_LUNG_L = LUNG_L;
export const CONTRACT_LIVER = LIVER;
export const CONTRACT_HEART = HEART;
