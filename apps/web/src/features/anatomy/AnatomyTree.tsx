import { useMemo, useState } from "react";
import { useAnatomySelection } from "../../v14/state/anatomySelection";
import { Panel } from "../../v12/design";
import { BODY } from "./ids";
import { childrenOf } from "./treeModel";
import { LOCAL_FIXTURE_LABEL, useAnatomySearch, useAnatomyTree } from "./useAnatomyCatalog";
import type { CatalogNode } from "./types";

function statusNote(n: CatalogNode): string | null {
  if (n.mesh_status === "unavailable") return "3D mesh unavailable";
  if (n.mesh_status === "approximate") return "Approximate volume";
  return null;
}

function TreeRow({
  node,
  nodes,
  depth,
  selected,
  onSelect,
}: {
  node: CatalogNode;
  nodes: CatalogNode[];
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const kids = childrenOf(nodes, node.id);
  const [open, setOpen] = useState(depth < 1 || node.id === BODY);
  const isSel = selected === node.id;
  const note = statusNote(node);
  return (
    <li
      role="treeitem"
      aria-expanded={kids.length > 0 ? open : undefined}
      aria-selected={isSel}
      aria-level={depth + 1}
      className="select-none"
    >
      <div className="flex items-start gap-1">
        {kids.length > 0 ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${node.label}` : `Expand ${node.label}`}
            className="mt-0.5 h-6 w-5 shrink-0 text-fg-3 hover:text-fg"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="mt-0.5 inline-block w-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className={`min-w-0 flex-1 rounded-control px-2 py-1 text-left text-sm ${
            isSel ? "bg-glacier/15 text-fg" : "text-fg-2 hover:bg-ink-700/70 hover:text-fg"
          }`}
        >
          <span className="block truncate font-medium">{node.label}</span>
          {node.laterality === "left" || node.laterality === "right" ? (
            <span className="mr-2 font-mono text-2xs uppercase text-fg-3">{node.laterality}</span>
          ) : null}
          {note ? <span className="block text-2xs text-fg-3">{note}</span> : null}
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul role="group" className="ml-3 border-l border-line/20 pl-1">
          {kids.map((c) => (
            <TreeRow key={c.id} node={c} nodes={nodes} depth={depth + 1} selected={selected} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function AnatomyTree() {
  const { tree, source } = useAnatomyTree();
  const [q, setQ] = useState("");
  const { hits } = useAnatomySearch(q, tree);
  const selected = useAnatomySelection((s) => s.anatomyId);
  const root = useMemo(() => tree.nodes.find((n) => n.id === tree.root_id) ?? tree.nodes[0], [tree]);
  const searching = q.trim().length > 0;

  const onSelect = (id: string) => {
    useAnatomySelection.getState().selectAnatomy(id, { focus: true, openDrawer: true });
  };

  return (
    <Panel
      title="Anatomy"
      className="max-h-full overflow-hidden"
      data-testid="anatomy-tree"
      data-source={source}
      actions={
        <span className="text-2xs text-fg-3">
          {source === "api" ? "Live atlas" : LOCAL_FIXTURE_LABEL}
        </span>
      }
    >
      <div className="pointer-events-auto flex min-h-0 flex-col gap-2 px-3 py-2">
        <label className="sr-only" htmlFor="anatomy-search">
          Search anatomy
        </label>
        <input
          id="anatomy-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search body parts"
          className="w-full rounded-control border border-line/25 bg-ink-900 px-3 py-1.5 text-sm text-fg placeholder:text-fg-3"
        />
        {searching ? (
          <ul className="min-h-0 overflow-auto" aria-label="Search results">
            {hits.length === 0 ? (
              <li className="px-1 py-2 text-sm text-fg-3">No matches in this atlas.</li>
            ) : (
              hits.map((h) => (
                <li key={`${h.result_type}:${h.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (h.result_type === "anatomy") onSelect(h.id);
                    }}
                    className="w-full rounded-control px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-ink-700/70 hover:text-fg"
                  >
                    <span className="font-medium text-fg">{h.label}</span>
                    <span className="ml-2 text-2xs text-fg-3">{h.result_type}</span>
                    {h.laterality === "left" || h.laterality === "right" ? (
                      <span className="ml-2 font-mono text-2xs uppercase text-fg-3">{h.laterality}</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : (
          <ul role="tree" aria-label="Anatomy atlas" className="min-h-0 overflow-auto pr-1">
            {root ? (
              <TreeRow node={root} nodes={tree.nodes} depth={0} selected={selected} onSelect={onSelect} />
            ) : (
              <li className="text-sm text-fg-3">Atlas is empty.</li>
            )}
          </ul>
        )}
      </div>
    </Panel>
  );
}
