import { Section } from "./Section";
import { docIndex, metaModel } from "../model";
import { CitationList } from "../figures/shared/CitationList";
import type { Citation } from "../model/types";

export function SourcesAppendix() {
  const citations: Citation[] = Object.keys(docIndex)
    .sort((a, b) => a.localeCompare(b))
    .map((docPath) => ({ docPath }));

  return (
    <Section id="sources" index="Appendix" title="Sources">
      <p>
        Every fact here traces to one of the docs below, or to code verified against this
        checkout (commit <code>{metaModel.sourceCommit.slice(0, 12)}</code>). Every fact inside a
        figure carries the same kind of citation. Click any citation, here or in a figure, to open
        the doc section or code path behind it on GitHub.
      </p>
      <CitationList citations={citations} className="sources-list" />
    </Section>
  );
}
