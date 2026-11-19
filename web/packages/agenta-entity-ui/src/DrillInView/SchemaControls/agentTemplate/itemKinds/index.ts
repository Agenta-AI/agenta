/**
 * Per-kind registry for the tool / MCP / skill list sections. They share one machinery (an
 * {@link ItemRow} list + a draft-then-save {@link ConfigItemDrawer}) and differ only in this data —
 * config array, classifier, form view, per-kind rules — so all three run through one code path.
 * Each kind lives in its own file.
 */
import {mcpKind} from "./mcp"
import {skillKind} from "./skill"
import {toolKind} from "./tool"
import type {ItemKind, ItemKindDef} from "./types"

export type {ItemFormView, ItemKind, ItemKindDef} from "./types"

export const ITEM_KINDS: Record<ItemKind, ItemKindDef> = {
    tool: toolKind,
    mcp: mcpKind,
    skill: skillKind,
}
