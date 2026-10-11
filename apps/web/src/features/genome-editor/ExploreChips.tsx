import { useAnatomySelection } from "../../v14/state/anatomySelection";
import { LOCAL_ANATOMY } from "./localAnatomy";
import type { DrawerSection } from "./EvidenceDrawer";

export interface ExploreChipsProps {
  onSection: (s: DrawerSection) => void;
  onWhy: () => void;
}

const chip =
  "pointer-events-auto rounded-full border border-white/20 bg-slate-950/55 px-2.5 py-1 text-xs text-slate-100 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300";

/** Fast chips when an organ / region is selected. Never draft an edit. */
export function ExploreChips({ onSection, onWhy }: ExploreChipsProps) {
  const anatomyId = useAnatomySelection((s) => s.anatomyId);
  const openDrawer = useAnatomySelection((s) => s.openDrawer);
  const selectAnatomy = useAnatomySelection((s) => s.selectAnatomy);
  if (!anatomyId) return null;
  const label = LOCAL_ANATOMY.find((a) => a.id === anatomyId)?.labels[0] ?? "this organ";

  return (
    <div className="pointer-events-none flex max-w-[640px] flex-wrap items-center gap-1.5" data-testid="explore-chips" role="group" aria-label="Explore this organ">
      <button
        type="button"
        className={chip}
        data-testid="chip-explore-organ"
        onClick={() => {
          selectAnatomy(anatomyId, { focus: true, openDrawer: true });
          onSection("anatomy");
        }}
      >
        Explore this organ
      </button>
      <button
        type="button"
        className={chip}
        data-testid="chip-related-genes"
        onClick={() => {
          openDrawer();
          onSection("genes");
        }}
      >
        See related genes
      </button>
      <button
        type="button"
        className={chip}
        data-testid="chip-inspect-reference"
        onClick={() => {
          openDrawer();
          onSection("sequence");
        }}
      >
        Inspect reference
      </button>
      <button type="button" className={chip} data-testid="chip-why-not-automatic" onClick={onWhy}>
        Why can&apos;t I make that edit automatically?
      </button>
      <span className="sr-only">{label}</span>
    </div>
  );
}
