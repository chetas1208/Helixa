#!/usr/bin/env python3
import asyncio
import os
import sys
from pathlib import Path

# Ensure project root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.integrations.elevenlabs import ElevenLabsAdapter
from services.integrations.mongodb import MongoDBClient
from services.integrations.raindrop import RaindropAdapter


async def check_all():
    print("=" * 60)
    print("DIAMOND Genome: Integration Connectivity Probe")
    print("=" * 60)

    # 1. MongoDB Check
    mongo_uri = os.getenv("MONGODB_URI", "mongodb://127.0.0.1:27017")
    mongo = MongoDBClient(uri=mongo_uri)
    mongo_ok = await mongo.ping()
    is_atlas = "mongodb+srv" in mongo_uri or "atlas" in mongo_uri.lower()
    if mongo_ok:
        env_type = "MongoDB Atlas Sandbox" if is_atlas else "Local MongoDB (Active)"
        print(f"[OK] MongoDB: CONNECTED ({env_type}) -> {mongo_uri}")
    else:
        print(f"[FAIL] MongoDB: INACCESSIBLE -> {mongo_uri}")
    await mongo.close()

    # 2. Raindrop Check
    raindrop = RaindropAdapter()
    if raindrop.status == "NOT_CONFIGURED":
        print("[SKIP] Raindrop Observability: NOT_CONFIGURED (API credentials omitted)")
    else:
        print(f"[OK] Raindrop Observability: CONFIGURED -> endpoint: {raindrop.endpoint}")

    # 3. ElevenLabs Check
    eleven = ElevenLabsAdapter()
    if eleven.status == "NOT_CONFIGURED":
        print("[SKIP] ElevenLabs Voice TTS: NOT_CONFIGURED (API key omitted, captions fallback active)")
    else:
        print(f"[OK] ElevenLabs Voice TTS: CONFIGURED -> voice_id: {eleven.voice_id}")

    # 4. Model Provider Check
    model_provider = os.getenv("MODEL_PROVIDER", "deterministic")
    if model_provider == "deterministic":
        print("[OK] Model Provider: DETERMINISTIC (Local research policy mutation library active)")
    else:
        api_key = os.getenv("MODEL_API_KEY", "")
        if api_key:
            print(f"[OK] Model Provider: OPENAI-COMPATIBLE -> {os.getenv('MODEL_BASE_URL')}")
        else:
            print("[WARN] Model Provider: Configured for external model but MODEL_API_KEY is missing. Using deterministic fallback.")

    print("=" * 60)
    print("Integration probe complete.")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(check_all())
