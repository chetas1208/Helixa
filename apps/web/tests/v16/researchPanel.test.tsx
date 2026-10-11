// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResearchEvidencePanel } from "../../src/v16/ResearchEvidencePanel";

const status = {
  health: "not_configured",
  verified: false,
  embedding_model: null,
  rerank_model: null,
  vector_search: { supported: false, active: false, reason: "local" },
  disclaimer: "citations",
};

const search = {
  status: "lexical_fallback",
  health: "not_configured",
  fallback_reason: "not_configured",
  disclaimer: "not causation",
  untrusted: true,
  citations: [
    {
      document_id: "doc-brca1",
      source_url: "https://www.ncbi.nlm.nih.gov/gene/672",
      title: "BRCA1",
      excerpt: "association only",
      evidence_type: "association",
      source_type: "official_database",
      provenance: "NCBI",
      gene_ids: ["BRCA1"],
      untrusted: true,
    },
  ],
  index: { mode: "lexical", vector_search_supported: false, vector_search_active: false },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("research evidence panel", () => {
  it("shows an honest unconfigured status and does not post a sequence", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/status")) {
        return new Response(JSON.stringify(status), { status: 200 });
      }
      bodies.push(String(init?.body ?? ""));
      return new Response(JSON.stringify(search), { status: 200 });
    }));
    render(<ResearchEvidencePanel surface="editor" geneId="BRCA1" assembly="GRCh38" />);
    expect((await screen.findByTestId("research-health")).textContent).toContain("not_configured");
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("doc-brca1")).toBeTruthy());
    expect(bodies[0]).toContain("BRCA1");
    expect(bodies[0]).not.toMatch(/[ACGT]{41}/);
    expect(screen.getByTestId("research-disclaimer").textContent).toContain("not a genotype-to-phenotype");
  });
});
