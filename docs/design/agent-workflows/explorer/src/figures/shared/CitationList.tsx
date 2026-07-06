/**
 * Renders a Citation[] (from model/types.ts) as an actual list of links, not
 * just <code> text. Used everywhere a citation shows up: SidePanel,
 * PayloadInspector, OutcomePanel, and the sources appendix, so "click any
 * citation" (sourcesAppendix's own prose) is true rather than aspirational.
 *
 * docPath is relative to docs/design/agent-workflows/ (per meta.json's
 * docIndex keys) and always resolves; every docPath in the model is a clean
 * path. codePath is messier: most are a clean repo-root-relative path (or a
 * few, "a.ts; b.ts" for distinct files, "dir/a.py, b.py, c.py" for siblings
 * of the first path, optionally ":123" for a line), but nodes.json also uses
 * it for prose annotations ("api/.../service.py (execute_tool)"), external
 * deps ("external: @earendil-works/pi-coding-agent (MIT, ...)"), and gaps
 * ("not implemented"). Only segments that parse as a real path become a
 * link; anything else renders as plain text rather than risk a broken or
 * misleading GitHub URL.
 */
import { docIndex } from "../../model";
import type { Citation } from "../../model/types";

const GITHUB_BLOB_BASE = "https://github.com/Agenta-AI/agenta/blob/main/";
const DOCS_ROOT = "docs/design/agent-workflows/";

/** word/dot/dash path segments joined by "/", optionally with a ":line" suffix. */
const PLAIN_PATH = /^[\w.-]+(\/[\w.-]+)*$/;

function docHref(docPath: string): string {
  return `${GITHUB_BLOB_BASE}${DOCS_ROOT}${docPath}`;
}

interface CodeRef {
  label: string;
  href?: string;
}

/**
 * Resolves one codePath string into one or more CodeRefs. Conservative by
 * design: a segment only becomes a link when, after any dir-prefix
 * expansion and ":line" stripping, what remains matches PLAIN_PATH.
 */
function resolveCodeRefs(codePath: string): CodeRef[] {
  return codePath.split(";").flatMap((rawSegment): CodeRef[] => {
    const segment = rawSegment.trim();
    // Prose annotations and external-dependency notes always carry a "(",
    // and splitting those on "," (e.g. "MIT, baked into the image") would
    // produce nonsense paths. Treat the whole segment as an opaque label.
    if (segment.includes("(")) return [{ label: segment }];

    const parts = segment.split(",").map((p) => p.trim());
    const [first, ...rest] = parts;
    const dir = first.includes("/") ? first.slice(0, first.lastIndexOf("/") + 1) : "";
    const paths = [first, ...rest.map((name) => (dir ? `${dir}${name}` : name))];

    return paths.map((path) => {
      const lineMatch = /^(.+):(\d+)$/.exec(path);
      const bare = lineMatch ? lineMatch[1] : path;
      if (!PLAIN_PATH.test(bare)) return { label: path };
      const anchor = lineMatch ? `#L${lineMatch[2]}` : "";
      return { label: path, href: `${GITHUB_BLOB_BASE}${bare}${anchor}` };
    });
  });
}

function CitationEntry({ citation }: { citation: Citation }) {
  const { docPath, codePath, section } = citation;
  const codeRefs = codePath ? resolveCodeRefs(codePath) : [];

  return (
    <>
      {docPath && (
        <a href={docHref(docPath)} target="_blank" rel="noreferrer">
          <code>{docPath}</code>
        </a>
      )}
      {docPath && codeRefs.length > 0 && " · "}
      {codeRefs.map((ref, i) => (
        <span key={ref.label}>
          {i > 0 && ", "}
          {ref.href ? (
            <a href={ref.href} target="_blank" rel="noreferrer">
              <code>{ref.label}</code>
            </a>
          ) : (
            <code>{ref.label}</code>
          )}
        </span>
      ))}
      {section && ` · ${section}`}
      {/* The doc's own title is only useful when nothing more specific (a
       * section name) is already shown; otherwise the two read as a
       * redundant, unpunctuated stack ("Built-in tools Tools"). */}
      {!section && docPath && docIndex[docPath] && <span className="doc-title"> {docIndex[docPath]}</span>}
    </>
  );
}

export function CitationList({
  citations,
  className = "citation-list",
}: {
  citations: Citation[];
  className?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <ul className={className}>
      {citations.map((citation, i) => (
        <li key={i}>
          <CitationEntry citation={citation} />
        </li>
      ))}
    </ul>
  );
}
