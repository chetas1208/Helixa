/**
 * Bidirectional `?anatomy=&gene=&locus=` <-> useAnatomySelection.
 * Compose with V12 useUrlSync: this helper never writes tab or workspace.
 */
import { useEffect, useRef } from "react";
import { useAnatomySelection } from "./anatomySelection";
import { parseAnatomyUrl, serialiseAnatomyUrl } from "./urlParams";

function writeUrl(sel: { anatomy: string | null; gene: string | null; locus: string | null }, reason: "bootstrap" | "user"): void {
  if (typeof window === "undefined") return;
  const next = serialiseAnatomyUrl(sel, window.location.search);
  const current = `${window.location.search}`;
  if (next === current || (next === "" && current === "")) return;
  const url = `${window.location.pathname}${next}${window.location.hash}`;
  try {
    if (reason === "user") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  } catch {
    /* sandboxed iframe / file:// */
  }
}

export function useAnatomyUrlSync(): void {
  const anatomyId = useAnatomySelection((s) => s.anatomyId);
  const geneId = useAnatomySelection((s) => s.geneId);
  const locusId = useAnatomySelection((s) => s.locusId);
  const applying = useRef(false);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (bootstrapped.current || typeof window === "undefined") return;
    bootstrapped.current = true;
    const parsed = parseAnatomyUrl(window.location.search);
    applying.current = true;
    const store = useAnatomySelection.getState();
    if (parsed.anatomy) store.selectAnatomy(parsed.anatomy, { focus: false, openDrawer: true });
    if (parsed.gene) {
      store.selectGene(parsed.gene);
      store.openDrawer();
    }
    if (parsed.locus) store.selectLocus(parsed.locus);
    applying.current = false;
    writeUrl({ anatomy: parsed.anatomy, gene: parsed.gene, locus: parsed.locus }, "bootstrap");
  }, []);

  useEffect(() => {
    if (!bootstrapped.current || applying.current) return;
    writeUrl({ anatomy: anatomyId, gene: geneId, locus: locusId }, "user");
  }, [anatomyId, geneId, locusId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const parsed = parseAnatomyUrl(window.location.search);
      applying.current = true;
      const store = useAnatomySelection.getState();
      if (parsed.anatomy) store.selectAnatomy(parsed.anatomy, { focus: false, openDrawer: true });
      if (parsed.gene) {
        store.selectGene(parsed.gene);
        store.openDrawer();
      }
      if (parsed.locus) store.selectLocus(parsed.locus);
      applying.current = false;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
}
