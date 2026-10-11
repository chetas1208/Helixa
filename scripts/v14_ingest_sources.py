#!/usr/bin/env python3
"""Verify Uberon CURIEs and cache the curated V14 gene/evidence/slice panel.

Usage:
  python scripts/v14_ingest_sources.py            # live fetch + rewrite fixtures
  python scripts/v14_ingest_sources.py --offline  # rebuild derived files from cache only
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from services.runtime.anatomy.paths import (  # noqa: E402
    BGEE_ANATOMY_MAP_PATH,
    BGEE_CACHE,
    CACHE_DIR,
    ENSEMBL_CACHE,
    FIXTURES_V14,
    GENES_PATH,
    GWAS_CACHE,
    HPA_CACHE,
    HPA_TISSUE_MAP_PATH,
    LOCI_MANIFEST_PATH,
    OLS4_CACHE,
    REFERENCE_ASSET_ID,
    SLICES_DIR,
    SOURCE_META_PATH,
    SYSTEMS_PATH,
    TREE_PATH,
    USER_AGENT,
)
from services.runtime.anatomy.seed import (  # noqa: E402
    BGEE_ANATOMY_MAP,
    HPA_TISSUE_MAP,
    KNOWN_LATERAL_CLASSES,
    PANEL_SYMBOLS,
    SEED_NODES,
    SEED_SYSTEMS,
    SLICE_WINDOWS,
    unique_curies,
)

OLS4_ONTOLOGY = "https://www.ebi.ac.uk/ols4/api/ontologies/uberon"
ENSEMBL_BASE = "https://rest.ensembl.org"
BGEE_URL = "https://www.bgee.org/api/?page=gene&action=expression&gene_id={gid}&species_id=9606&display_type=json"
HPA_URL = "https://www.proteinatlas.org/{gid}.json"
GWAS_URL = "https://www.ebi.ac.uk/gwas/rest/api/v2/associations?mapped_gene={sym}&size=40"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _request(url: str, accept: str = "application/json") -> tuple[int, bytes, str]:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": accept, "Content-Type": accept},
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, resp.read(), resp.geturl()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read() if exc.fp else b"", url


def get_json(url: str) -> dict | list:
    status, raw, _final = _request(url, "application/json")
    if status != 200:
        raise RuntimeError(f"GET {url} -> {status}")
    return json.loads(raw.decode("utf-8"))


def get_text(url: str) -> str:
    status, raw, _final = _request(url, "text/plain")
    if status != 200:
        raise RuntimeError(f"GET {url} -> {status}")
    return raw.decode("utf-8").strip()


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path: Path) -> dict | list:
    return json.loads(path.read_text(encoding="utf-8"))


def cache_wrap(path: Path, source_version: str, source_url: str, payload: object, retrieved_at: str | None = None) -> dict:
    rec = {
        "retrieved_at": retrieved_at or utc_now(),
        "source_version": source_version,
        "source_url": source_url,
        "payload": payload,
    }
    write_json(path, rec)
    return rec


def load_cache(path: Path) -> dict | None:
    if not path.exists():
        return None
    return read_json(path)


def ols4_term_url(curie: str) -> str:
    iri = "http://purl.obolibrary.org/obo/" + curie.replace(":", "_")
    enc = urllib.parse.quote(urllib.parse.quote(iri, safe=""), safe="")
    return f"https://www.ebi.ac.uk/ols4/api/ontologies/uberon/terms/{enc}"


def ols4_class_page(curie: str) -> str:
    iri = "http://purl.obolibrary.org/obo/" + curie.replace(":", "_")
    return "https://www.ebi.ac.uk/ols4/ontologies/uberon/classes/" + urllib.parse.quote(iri, safe="")


def verify_uberon(offline: bool) -> tuple[dict[str, dict], str]:
    OLS4_CACHE.mkdir(parents=True, exist_ok=True)
    version = "2026-10-01"
    if not offline:
        try:
            ont = get_json(OLS4_ONTOLOGY)
            cache_wrap(CACHE_DIR / "ols4_ontology.json", version, OLS4_ONTOLOGY, ont)
            viri = ((ont.get("config") or {}).get("versionIri")) or ""
            if "/releases/" in viri:
                version = viri.split("/releases/")[1].split("/")[0]
        except Exception as exc:
            print(f"warning: OLS4 ontology probe failed ({exc}); using cached version {version}")
    else:
        cached = load_cache(CACHE_DIR / "ols4_ontology.json")
        if cached:
            viri = (((cached.get("payload") or {}).get("config") or {}).get("versionIri")) or ""
            if "/releases/" in viri:
                version = viri.split("/releases/")[1].split("/")[0]
    verified: dict[str, dict] = {}
    for curie in unique_curies():
        path = OLS4_CACHE / f"{curie.replace(':', '_')}.json"
        rec = load_cache(path)
        if rec is None and offline:
            verified[curie] = {"ok": False, "reason": "missing-cache"}
            continue
        if rec is None:
            url = ols4_term_url(curie)
            try:
                payload = get_json(url)
                rec = cache_wrap(path, version, url, payload)
                time.sleep(0.08)
            except Exception as exc:
                print(f"OLS4 FAIL {curie}: {exc}")
                verified[curie] = {"ok": False, "reason": str(exc)}
                continue
        payload = rec.get("payload") or {}
        ok = bool(payload.get("obo_id") == curie and not payload.get("is_obsolete"))
        verified[curie] = {
            "ok": ok,
            "label": payload.get("label"),
            "description": (payload.get("description") or [None])[0],
            "synonyms": payload.get("synonyms") or [],
            "retrieved_at": rec.get("retrieved_at"),
            "source_version": rec.get("source_version") or version,
        }
        print(f"{'OK' if ok else 'UNMAPPED'} {curie} {payload.get('label')}")
    return verified, version


def build_tree(verified: dict[str, dict], uberon_version: str) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    for raw in SEED_NODES:
        node = deepcopy(raw)
        oid = node.get("ontology_id")
        if oid:
            info = verified.get(oid) or {}
            if not info.get("ok"):
                slug = node["id"].replace(":", "-").replace("@", "-").lower()
                node["id"] = f"DIAMOND:{slug}" if not node["id"].startswith("DIAMOND:") else node["id"]
                node["ontology_id"] = None
                node["ontology_status"] = "unmapped"
                node["ontology_label"] = None
                node["source"] = {
                    "name": "DIAMOND local atlas fixture",
                    "version": "v14-agent2",
                    "url": "https://www.ebi.ac.uk/ols4/ontologies/uberon",
                }
            else:
                node["ontology_status"] = "verified"
                node["ontology_label"] = info.get("label")
                if info.get("description") and not node.get("description"):
                    node["description"] = info["description"]
                    node["description_source"] = {
                        "name": "Uberon",
                        "version": uberon_version,
                        "url": ols4_class_page(oid),
                    }
                extra = [s for s in (info.get("synonyms") or []) if isinstance(s, str)]
                merged = list(dict.fromkeys([*(node.get("synonyms") or []), *extra[:12]]))
                node["synonyms"] = merged
                node["source"] = {
                    "name": "Uberon via OLS4",
                    "version": uberon_version,
                    "url": ols4_class_page(oid),
                }
        else:
            node["ontology_status"] = "unmapped"
            node["source"] = {
                "name": "DIAMOND local atlas fixture",
                "version": "v14-agent2",
                "url": "https://www.ebi.ac.uk/ols4/ontologies/uberon",
            }
        # Drop tissue_context ids that failed verification.
        kept = []
        for tid in node.get("tissue_context_ids") or []:
            if (verified.get(tid) or {}).get("ok"):
                kept.append(tid)
        node["tissue_context_ids"] = kept
        nodes.append(node)

    systems = []
    for raw in SEED_SYSTEMS:
        sys = deepcopy(raw)
        oid = sys.get("ontology_id")
        info = verified.get(oid) or {}
        if oid and not info.get("ok"):
            sys["ontology_id"] = None
        sys["member_ids"] = [n["id"] for n in nodes if sys["id"] in (n.get("system_ids") or [])]
        sys["source"] = {
            "name": "Uberon via OLS4",
            "version": uberon_version,
            "url": ols4_class_page(oid) if oid and info.get("ok") else OLS4_ONTOLOGY,
        }
        systems.append(sys)
    return nodes, systems


def fetch_ensembl(offline: bool) -> dict[str, dict]:
    ENSEMBL_CACHE.mkdir(parents=True, exist_ok=True)
    genes: dict[str, dict] = {}
    for symbol in PANEL_SYMBOLS:
        path = ENSEMBL_CACHE / f"{symbol}.json"
        rec = load_cache(path)
        if rec is None and offline:
            print(f"offline missing Ensembl cache for {symbol}")
            continue
        if rec is None:
            url = f"{ENSEMBL_BASE}/lookup/symbol/homo_sapiens/{symbol}?content-type=application/json;expand=1"
            payload = get_json(url)
            rec = cache_wrap(path, "release 116", url, payload)
            time.sleep(0.15)
        genes[symbol] = rec
        print(f"Ensembl {symbol} {(rec.get('payload') or {}).get('id')}")
    return genes


def fetch_slices(ensembl: dict[str, dict], offline: bool) -> list[dict]:
    SLICES_DIR.mkdir(parents=True, exist_ok=True)
    loci = []
    for symbol, (contig, start, end) in SLICE_WINDOWS.items():
        rec = ensembl.get(symbol)
        if not rec:
            continue
        gene = rec["payload"]
        length = end - start + 1
        if length > 1000:
            raise RuntimeError(f"{symbol} slice longer than 1000 bp")
        fasta_name = f"{symbol}_{contig}_{start}-{end}.fa"
        fasta_path = SLICES_DIR / fasta_name
        seq_url = (
            f"{ENSEMBL_BASE}/sequence/region/homo_sapiens/{contig}:{start}..{end}:1"
            f"?content-type=text/plain"
        )
        if fasta_path.exists():
            text = fasta_path.read_text(encoding="utf-8")
            bases = "".join(line.strip() for line in text.splitlines() if line and not line.startswith(">")).upper()
        elif offline:
            raise RuntimeError(f"offline missing slice {fasta_path}")
        else:
            bases = get_text(seq_url).upper()
            if any(b not in "ACGTN" for b in bases):
                raise RuntimeError(f"unexpected bases in {symbol} slice")
            fasta_path.write_text(
                f">grch38:{symbol}:{contig}:{start}-{end} GRCh38 Ensembl 116\n{bases}\n",
                encoding="utf-8",
            )
            time.sleep(0.15)
        digest = hashlib.sha256(bases.encode("ascii")).hexdigest()
        features: list[dict] = []
        feat_cache = ENSEMBL_CACHE / f"{symbol}_overlap.json"
        feat_rec = load_cache(feat_cache)
        if feat_rec is None and not offline:
            feat_url = (
                f"{ENSEMBL_BASE}/overlap/region/homo_sapiens/{contig}:{start}-{end}"
                f"?feature=exon;content-type=application/json"
            )
            try:
                feat_payload = get_json(feat_url)
                feat_rec = cache_wrap(feat_cache, "release 116", feat_url, feat_payload)
                time.sleep(0.1)
            except Exception as exc:
                print(f"overlap skip {symbol}: {exc}")
                feat_rec = None
        for feat in (feat_rec or {}).get("payload") or []:
            if not isinstance(feat, dict):
                continue
            features.append(
                {
                    "feature_type": feat.get("feature_type") or "exon",
                    "id": feat.get("id"),
                    "transcript_id": feat.get("Parent") or feat.get("transcript_id"),
                    "start": feat.get("start"),
                    "end": feat.get("end"),
                    "strand": feat.get("strand"),
                }
            )
        canon = gene.get("canonical_transcript")
        locus_id = f"grch38:{symbol}:{contig}:{start}-{end}"
        loci.append(
            {
                "locus_id": locus_id,
                "gene_id": gene.get("id"),
                "gene_symbol": symbol,
                "assembly": "GRCh38",
                "contig": str(contig),
                "start": start,
                "end": end,
                "length": length,
                "gene_strand": gene.get("strand"),
                "sequence_sha256": digest,
                "reference_asset_id": REFERENCE_ASSET_ID,
                "label": f"{symbol} region (GRCh38 {contig}:{start:,}-{end:,})",
                "features": features,
                "fasta_file": fasta_name,
                "source": {
                    "name": "Ensembl REST /sequence/region",
                    "version": "release 116",
                    "url": seq_url,
                },
                "canonical_transcript": canon,
            }
        )
        print(f"slice {locus_id} sha256={digest[:12]}… n={length}")
    write_json(
        LOCI_MANIFEST_PATH,
        {
            "reference_asset_id": REFERENCE_ASSET_ID,
            "assembly": "GRCh38",
            "assembly_patch": "GRCh38.p14",
            "ensembl_release": 116,
            "retrieved_at": utc_now(),
            "immutable": True,
            "loci": loci,
        },
    )
    return loci


def gene_records(ensembl: dict[str, dict], loci: list[dict]) -> list[dict]:
    by_symbol = {loc["gene_symbol"]: loc for loc in loci}
    out = []
    for symbol, rec in ensembl.items():
        gene = rec["payload"]
        desc = (gene.get("description") or "").split(" [Source:", 1)[0].strip()
        loc = by_symbol.get(symbol)
        hpa = load_cache(HPA_CACHE / f"{gene.get('id')}.json")
        panel_reason = None
        if hpa:
            payload = hpa.get("payload") or {}
            spec = payload.get("RNA tissue specificity")
            ntpms = payload.get("RNA tissue specific nTPM") or {}
            if spec or ntpms:
                tissues = ", ".join(ntpms.keys()) if isinstance(ntpms, dict) else ""
                panel_reason = f"HPA: {str(spec).lower()}" + (f" in {tissues}" if tissues else "")
        out.append(
            {
                "gene_id": gene.get("id"),
                "version": gene.get("version"),
                "symbol": gene.get("display_name") or symbol,
                "description": desc,
                "biotype": gene.get("biotype"),
                "assembly": "GRCh38",
                "assembly_patch": gene.get("assembly_name") or "GRCh38.p14",
                "ensembl_release": 116,
                "contig": str(gene.get("seq_region_name")),
                "start": gene.get("start"),
                "end": gene.get("end"),
                "strand": gene.get("strand"),
                "canonical_transcript": gene.get("canonical_transcript"),
                "locus_ids": [loc["locus_id"]] if loc else [],
                "panel_reason": panel_reason,
                "source": {
                    "name": "Ensembl REST",
                    "version": "release 116",
                    "url": f"{ENSEMBL_BASE}/lookup/id/{gene.get('id')}",
                },
                "retrieved_at": rec.get("retrieved_at"),
            }
        )
    return out


def fetch_evidence(genes: list[dict], offline: bool) -> None:
    BGEE_CACHE.mkdir(parents=True, exist_ok=True)
    HPA_CACHE.mkdir(parents=True, exist_ok=True)
    GWAS_CACHE.mkdir(parents=True, exist_ok=True)
    for gene in genes:
        gid = gene["gene_id"]
        symbol = gene["symbol"]
        bgee_path = BGEE_CACHE / f"{gid}.json"
        if load_cache(bgee_path) is None and not offline:
            url = BGEE_URL.format(gid=gid)
            try:
                payload = get_json(url)
                cache_wrap(bgee_path, "Bgee 15.2.5", url, payload)
                print(f"Bgee {symbol} calls={len(((payload.get('data') or {}).get('calls') or []))}")
            except Exception as exc:
                print(f"Bgee unavailable {symbol}: {exc}")
            time.sleep(0.2)
        hpa_path = HPA_CACHE / f"{gid}.json"
        if load_cache(hpa_path) is None and not offline:
            url = HPA_URL.format(gid=gid)
            try:
                payload = get_json(url)
                cache_wrap(hpa_path, "Human Protein Atlas (proteinatlas.org 2026-10-11)", url, payload)
                print(f"HPA {symbol}")
            except Exception as exc:
                print(f"HPA unavailable {symbol}: {exc}")
            time.sleep(0.2)
        gwas_path = GWAS_CACHE / f"{symbol}.json"
        if load_cache(gwas_path) is None and not offline:
            url = GWAS_URL.format(sym=urllib.parse.quote(symbol))
            try:
                payload = get_json(url)
                n = len(((payload.get("_embedded") or {}).get("associations") or []))
                cache_wrap(gwas_path, "GWAS Catalog REST API v2", url, payload)
                print(f"GWAS v2 {symbol} n={n}")
            except Exception as exc:
                print(f"GWAS unavailable {symbol}: {exc}")
            time.sleep(0.2)
        elif offline and load_cache(gwas_path) is None:
            print(f"offline missing GWAS cache for {symbol}")


def main() -> int:
    parser = argparse.ArgumentParser(description="V14 anatomy/evidence ingest")
    parser.add_argument("--offline", action="store_true", help="Use fixtures/v14/cache only; no network")
    args = parser.parse_args()
    FIXTURES_V14.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    verified, uberon_version = verify_uberon(args.offline)
    nodes, systems = build_tree(verified, uberon_version)
    write_json(TREE_PATH, {"root_id": "UBERON:0013702", "uberon_version": uberon_version, "nodes": nodes})
    write_json(SYSTEMS_PATH, {"systems": systems})
    write_json(HPA_TISSUE_MAP_PATH, HPA_TISSUE_MAP)
    write_json(BGEE_ANATOMY_MAP_PATH, BGEE_ANATOMY_MAP)

    ensembl = fetch_ensembl(args.offline)
    loci = fetch_slices(ensembl, args.offline)
    draft_genes = [
        {
            "gene_id": rec["payload"]["id"],
            "symbol": rec["payload"].get("display_name") or symbol,
        }
        for symbol, rec in ensembl.items()
        if rec.get("payload")
    ]
    fetch_evidence(draft_genes, args.offline)
    genes = gene_records(ensembl, loci)
    write_json(GENES_PATH, {"genes": genes, "ensembl_release": 116, "assembly": "GRCh38"})

    meta = {
        "retrieved_at": utc_now(),
        "offline": args.offline,
        "sources": {
            "ensembl": {"version": "release 116", "assembly": "GRCh38.p14", "rest": "15.12"},
            "uberon_ols4": {"version": uberon_version, "version_iri": f"http://purl.obolibrary.org/obo/uberon/releases/{uberon_version}/uberon.owl"},
            "bgee": {"version": "Bgee 15.2.5", "note": "homepage listed 15.2.5; API payload has no version field"},
            "hpa": {"version": "Human Protein Atlas live site 2026-10-11", "licence": "CC BY 4.0 for copyrightable database parts"},
            "gwas": {"version": "REST API v2", "note": "v1 is never used"},
        },
        "panel_symbols": PANEL_SYMBOLS,
        "known_lateral_classes": KNOWN_LATERAL_CLASSES,
        "n_nodes": len(nodes),
        "n_verified_curies": sum(1 for v in verified.values() if v.get("ok")),
        "n_failed_curies": [k for k, v in verified.items() if not v.get("ok")],
    }
    write_json(SOURCE_META_PATH, meta)
    print(json.dumps({"nodes": len(nodes), "genes": len(genes), "loci": len(loci), "failed": meta["n_failed_curies"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
