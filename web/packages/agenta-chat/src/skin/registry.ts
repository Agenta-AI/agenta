/**
 * Skin registration store + resolvers (WP3a-C5).
 *
 * The store starts EMPTY. The OSS registries (`clientTools/registry.tsx`, `approvals/registry.tsx`,
 * `assets/toolDisplay.ts`) remain the desktop chat's own store — byte-untouched, per the plan's
 * COPY-mode banner — until the desktop re-plumb PR switches them onto `registerChatSkin`. Until
 * then, only a skin that calls `registerChatSkin` (mobile shadcn first, WP3b) populates any entry
 * here; nothing in this package calls it.
 */
import {parseGatewayToolName} from "@agenta/entities/workflow/commitDiff"

import type {
    ApprovalBodyEntry,
    ChatSkinRegistration,
    ClientToolMeta,
    ClientToolWidget,
    ResolvedToolDisplay,
    ToolDisplayEntry,
    ToolKind,
} from "./types"

interface RegistrationStore {
    clientTools: {
        byRenderKind: Record<string, ClientToolWidget>
        byToolName: Record<string, ClientToolWidget>
    }
    approvals: Record<string, ApprovalBodyEntry>
    toolDisplay: Record<string, ToolDisplayEntry>
}

const store: RegistrationStore = {
    clientTools: {byRenderKind: {}, byToolName: {}},
    approvals: {},
    toolDisplay: {},
}

/**
 * Merge a skin's contribution into the shared store. Merge semantics: per key, the LATEST
 * registration wins (a later call's entry overwrites an earlier call's entry for the same key);
 * keys the new registration doesn't mention are left untouched. Registering `{}` or omitting a
 * sub-map is a no-op for that sub-map.
 */
export const registerChatSkin = (skin: ChatSkinRegistration): void => {
    if (skin.clientTools?.byRenderKind) {
        Object.assign(store.clientTools.byRenderKind, skin.clientTools.byRenderKind)
    }
    if (skin.clientTools?.byToolName) {
        Object.assign(store.clientTools.byToolName, skin.clientTools.byToolName)
    }
    if (skin.approvals) Object.assign(store.approvals, skin.approvals)
    if (skin.toolDisplay) Object.assign(store.toolDisplay, skin.toolDisplay)
}

/**
 * Resolve the widget for a client tool, or `undefined` when none is registered. Same precedence as
 * OSS `resolveClientToolHandler`: `render.kind` first (the finer dispatch axis), then `toolName`.
 */
export const resolveClientToolWidget = (
    meta: Pick<ClientToolMeta, "toolName" | "renderKind">,
): ClientToolWidget | undefined => {
    if (meta.renderKind && store.clientTools.byRenderKind[meta.renderKind]) {
        return store.clientTools.byRenderKind[meta.renderKind]
    }
    return store.clientTools.byToolName[meta.toolName]
}

/** Whether this client tool has a dedicated widget registered (used to route known tools in every
 * state, mirroring OSS `hasClientToolHandler`). */
export const hasClientToolWidget = (
    meta: Pick<ClientToolMeta, "toolName" | "renderKind">,
): boolean => resolveClientToolWidget(meta) !== undefined

/** Resolve the renderer for an approval, or `undefined` for the generic card (mirrors OSS
 * `resolveApprovalRenderer`, which returns `null` for the same miss). */
export const resolveApprovalBody = (toolName: string): ApprovalBodyEntry | undefined =>
    store.approvals[toolName]

// Copied verbatim from web/oss/src/components/AgentChatSlice/assets/toolDisplay.ts (2026-07-25);
// the OSS original remains authoritative for the desktop chat until the re-plumb PR deletes it.
// Keep byte-parity if either side changes. (`parseGatewayToolName` itself is NOT copied — it
// already lives in `@agenta/entities/workflow/commitDiff`, an existing package dependency, and is
// imported directly above.)
const parseNameShape = (raw: string): {label: string; source?: string; kind: ToolKind} => {
    // mcp__{server}__{tool} → tool from "Server · MCP".
    if (raw.startsWith("mcp__")) {
        const parts = raw.split("__").filter(Boolean)
        const tool = parts[parts.length - 1]
        const server = parts.length >= 3 ? parts[1] : undefined
        return {
            label: parseGatewayToolName(tool).label,
            source: server ? `${parseGatewayToolName(server).label} · MCP` : "MCP",
            kind: "mcp",
        }
    }
    const parsed = parseGatewayToolName(raw)
    return {...parsed, kind: parsed.source ? "gateway" : "platform"}
}

/**
 * Resolve display info for a raw runtime tool name. Pure and total — never throws. Reproduces the
 * OSS `resolveToolDisplay` fallback chain: a registered entry overrides label/source/kind/summary
 * piecewise; anything it doesn't override falls back to the name-shape heuristics above
 * (`mcp__…` server/tool split, gateway `tools__provider__integration__ACTION` parsing, or a
 * title-cased raw name).
 */
export const resolveToolDisplay = (raw: string): ResolvedToolDisplay => {
    const override = store.toolDisplay[raw]
    const parsed = parseNameShape(raw)
    return {
        raw,
        kind: override?.kind ?? parsed.kind,
        label: override?.label ?? parsed.label,
        source: override?.source ?? parsed.source,
        summary: override?.summary,
    }
}
