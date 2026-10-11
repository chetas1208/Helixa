import time

from fastapi import APIRouter

router = APIRouter(prefix="/api/scene", tags=["scene"])

# Epoch anchored to a stable reference point
SCENE_EPOCH = 1776000000.0

@router.get("/state")
async def get_scene_state():
    """
    Returns deterministic 300-second revolving DNA cycle metadata.
    Cycle index, phase [0.0, 1.0], and current procedural visual configuration.
    """
    now = time.time()
    elapsed = max(0.0, now - SCENE_EPOCH)
    cycle_duration = 300.0
    cycle_index = int(elapsed // cycle_duration)
    cycle_phase = (elapsed % cycle_duration) / cycle_duration  # 0.0 to 1.0

    # 5 deterministic procedural styles
    styles = [
        {"name": "molecular_glass", "palette": ["#00f0ff", "#0070f3"], "emissive_intensity": 0.4, "radius": 1.2},
        {"name": "luminous_strand", "palette": ["#a855f7", "#ec4899"], "emissive_intensity": 0.6, "radius": 1.3},
        {"name": "scientific_wireframe", "palette": ["#10b981", "#06b6d4"], "emissive_intensity": 0.3, "radius": 1.1},
        {"name": "chromatin_abstraction", "palette": ["#f59e0b", "#ef4444"], "emissive_intensity": 0.5, "radius": 1.4},
        {"name": "bioluminescent_deep", "palette": ["#38bdf8", "#818cf8"], "emissive_intensity": 0.7, "radius": 1.25},
    ]
    current_style = styles[cycle_index % len(styles)]
    next_style = styles[(cycle_index + 1) % len(styles)]

    return {
        "epoch": SCENE_EPOCH,
        "elapsed_seconds": elapsed,
        "cycle_duration": cycle_duration,
        "cycle_index": cycle_index,
        "cycle_phase": cycle_phase,
        "current_style": current_style,
        "next_style": next_style,
        "is_transitioning": (cycle_phase >= 0.85),  # 20-40s smooth morph window at end of 300s
    }
