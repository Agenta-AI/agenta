/**
 * Per-agent icon and colour, chosen from the picker and persisted client-side.
 *
 * Client-side only for now: the backend home is the workflow ARTIFACT's `meta`, but writing it
 * needs the update guard in `workflow/api/api.ts` fixed first (it ignores meta-only changes). Until
 * then localStorage keeps the choice, keyed by workflow id.
 *
 * `agentIconAtomFamily` is the ONLY public seam. Keep the storage map private — it is a localStorage
 * shape with no meaning once the data lives on the artifact, and exporting it would be a second seam
 * the backend swap has to preserve.
 */
import {atom} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import {writeBounded} from "./boundedMap"

export interface AgentIconRecord {
    /** Kebab-case Phosphor name. */
    icon: string
    color: string
    /** Inner SVG markup for the glyph, cached from the catalog so a cold render paints at once. */
    path: string
}

const STORAGE_KEY = "agenta:agent-icon:1"
/** Each record carries ~0.5 KB of SVG, and this is re-serialized on every write — bound it to a
 * realistic number of agents rather than a round one. */
const MAX_ENTRIES = 50

/** The shapes the generator emits, and only quoted attributes after the tag name. */
const SVG_SHAPE =
    /^<(?:path|circle|rect|line|polyline|polygon|ellipse|g)((?:\s+[a-zA-Z-]+=(?:"[^"]*"|'[^']*'))*)\s*\/?>$/
const SVG_ATTR = /\s+([a-zA-Z-]+)=(?:"[^"]*"|'[^']*')/g

/** Geometry and presentation only. The allowlist is what keeps `onload` and friends out. */
const SVG_ATTRS = new Set([
    "d",
    "cx",
    "cy",
    "r",
    "rx",
    "ry",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "width",
    "height",
    "points",
    "transform",
    "fill",
    "fill-rule",
    "fill-opacity",
    "clip-rule",
    "opacity",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
])

const isSvgShape = (tag: string): boolean => {
    const match = SVG_SHAPE.exec(tag)
    if (!match) return false
    return [...match[1].matchAll(SVG_ATTR)].every(([, name]) => SVG_ATTRS.has(name))
}

/**
 * localStorage is outside the trust boundary and `path` reaches `dangerouslySetInnerHTML`, so an
 * entry is validated element by element and attribute by attribute.
 */
export const isAgentIconPath = (path: string): boolean => {
    if (!path.startsWith("<")) return false
    const tags = path.match(/<[^>]*>/g)
    // Only whitespace may sit between shapes; any other text means it is not a generated glyph.
    if (!tags || tags.join("") !== path.replace(/>\s+</g, "><")) return false
    return tags.every(isSvgShape)
}

/** Exported for its own tests — a validator, not a second storage seam. */
export const isAgentIconRecord = (value: unknown): value is AgentIconRecord => {
    const r = value as AgentIconRecord | null
    return (
        !!r &&
        typeof r === "object" &&
        typeof r.icon === "string" &&
        typeof r.color === "string" &&
        typeof r.path === "string" &&
        isAgentIconPath(r.path)
    )
}

const agentIconMapAtom = atomWithStorage<Record<string, AgentIconRecord>>(
    STORAGE_KEY,
    {},
    undefined,
    {getOnInit: true},
)

/** Read/write one agent's icon. Writing `null` clears it back to the default chrome. */
export const agentIconAtomFamily = atomFamily((workflowId: string) =>
    atom(
        (get) => {
            if (!workflowId) return null
            // A literal `null` in localStorage reaches us as null, not the default.
            const stored = get(agentIconMapAtom)?.[workflowId]
            return isAgentIconRecord(stored) ? stored : null
        },
        (get, set, next: AgentIconRecord | null) => {
            if (!workflowId) return
            set(
                agentIconMapAtom,
                writeBounded(get(agentIconMapAtom) ?? {}, workflowId, next, MAX_ENTRIES),
            )
        },
    ),
)
