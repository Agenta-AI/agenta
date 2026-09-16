/**
 * An MCP server that did not join the run, as something the reader of the chat can act on.
 *
 * The runner emits `mcp_server_failed` when a configured server fails its handshake, and the SDK
 * projects it to the browser as a `data-mcp-server-failed` part. A disconnected OAuth connection
 * refuses that handshake with the remedy attached: `detail.code` is `auth_required` and
 * `detail.details.requirement.connect` names the endpoint that reconnects it.
 *
 * Until now nothing in the chat read that part. What the reader saw instead was the harness's own
 * account of the consequence — a red "Echo failed" card wrapping
 * `<tool_use_error>Error: No such tool available: mcp__mock-mcp__echo</tool_use_error>` — which
 * says nothing about authorization and offers nothing to do, while the agent's configuration rail
 * on the same page reads "Needs authorization · Connect". The product knew the state and had the
 * action; the run used neither (UI QA round 3, D2).
 *
 * This module is the mapping from the notice to what is shown, and nothing else: no React, no
 * queries. The refusal inside `detail` is read through `gatewayRefusalMessage` — the reader the MCP
 * connect dialog and the permission editor use — so the marker the runner addresses to itself
 * (`⟦agenta_code:auth_required⟧`) never reaches a screen through this path either.
 */
import {gatewayRefusalCode, gatewayRefusalMessage} from "@agenta/entities/mcpEndpoint/refusal"
import type {UIMessage} from "ai"

import {MCP_SERVER_NOTICE_PART} from "./parts"

/** The failure class a disconnected connection refuses its handshake with. */
export const MCP_AUTH_REQUIRED_CODE = "auth_required"

export interface McpServerNotice {
    /** The server as the agent's configuration names it (`mock-mcp`). */
    serverName: string
    /** The refusal's own sentence, marker stripped; the runner's line when there was no refusal. */
    statedMessage: string | null
    /** The slug the requirement's target names, which resolves to the endpoint row. */
    slug: string | null
    /** This server is disconnected and reconnecting is what fixes it. */
    needsAuthorization: boolean
}

const readString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value : null

const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null

/** `custom/<slug>` → `<slug>`. A target with no namespace half is already the slug. */
export const slugFromMcpTarget = (target: string | null): string | null => {
    if (!target) return null
    const cut = target.lastIndexOf("/")
    const slug = cut >= 0 ? target.slice(cut + 1) : target
    return slug.trim() ? slug : null
}

/** Read one `data-mcp-server-failed` payload. Returns `null` for anything that is not one. */
export const readMcpServerNotice = (data: unknown): McpServerNotice | null => {
    const record = asRecord(data)
    const serverName = readString(record?.serverName)
    if (!serverName) return null

    const detail = asRecord(record?.detail)
    // The same shape the reader already knows, so a refusal reads identically here and in the
    // connect dialog. It strips the code marker and appends `next_step` when one is named.
    const shaped = {response: {data: {detail}}}
    const code = detail ? gatewayRefusalCode(shaped) : null
    const refusal = detail ? gatewayRefusalMessage(shaped) : null

    const requirement = asRecord(asRecord(detail?.details)?.requirement)

    return {
        serverName,
        statedMessage: refusal ?? readString(record?.message),
        slug: slugFromMcpTarget(readString(requirement?.target)),
        needsAuthorization:
            code === MCP_AUTH_REQUIRED_CODE || readString(requirement?.state) === "needs_auth",
    }
}

/** Every server notice a turn carries, in the order the run emitted them. */
export const mcpServerNotices = (parts: UIMessage["parts"]): McpServerNotice[] => {
    const notices: McpServerNotice[] = []
    for (const part of parts) {
        if (part.type !== MCP_SERVER_NOTICE_PART) continue
        const notice = readMcpServerNotice((part as {data?: unknown}).data)
        if (notice) notices.push(notice)
    }
    return notices
}

export interface McpServerNoticeCopy {
    /** The first sentence, which the banner sets in the foreground weight. */
    lead: string
    /** The rest, or null when the notice is one sentence. */
    detail: string | null
}

/**
 * What the turn says about a server that did not join it, split the way the banner sets it.
 *
 * The expired-login wording is the spec's D4 banner copy, so the sentence a run shows is the
 * sentence the permission drawer shows for the same connection. D4's third sentence, "Permissions
 * below are kept", is dropped here: it points at controls that exist in the drawer and at nothing
 * in a transcript.
 *
 * `displayName` is the connection's own name once a caller has resolved the endpoint row; without
 * one the server name from the agent's configuration is the closest thing the notice itself holds.
 * A server that failed for any other reason keeps the sentence the run already wrote, because
 * inventing a second wording for a cause we have not classified would say less, not more.
 */
export const mcpServerNoticeCopy = (
    notice: McpServerNotice,
    displayName?: string | null,
): McpServerNoticeCopy => {
    const name = readString(displayName) ?? notice.serverName
    if (notice.needsAuthorization)
        return {
            lead: `${name} needs a new sign-in.`,
            detail: "Its tools fail until someone in the project reconnects.",
        }
    return {
        lead: notice.statedMessage ?? `${name} did not connect, so its tools were unavailable`,
        detail: null,
    }
}

/** The same account of the server as one string, for a caller with one slot to put it in. */
export const mcpServerNoticeSentence = (
    notice: McpServerNotice,
    displayName?: string | null,
): string => {
    const {lead, detail} = mcpServerNoticeCopy(notice, displayName)
    return detail ? `${lead} ${detail}` : lead
}

/**
 * The server half of an MCP tool's wire name, or `null` when the name is not one.
 *
 * Every harness spells this differently — Claude sends `mcp__mock-mcp__echo`, Codex sends
 * `mcp.mock-mcp.echo` — and both are the same configured server. Matching on the punctuation is
 * how the server name gets lost, so the separator is chosen from the prefix and the segments are
 * read positionally (OR80 makes the same argument for the runner's permission lookup).
 */
export const mcpToolServerName = (wireName: string): string | null => {
    const separator = wireName.startsWith("mcp__") ? "__" : wireName.startsWith("mcp.") ? "." : null
    if (!separator) return null
    const segments = wireName.split(separator).filter(Boolean)
    return segments.length >= 3 ? segments[1] : null
}

/**
 * Is this tool's failure already accounted for by a notice in the same turn?
 *
 * Only for a server the turn says needs authorizing. The tool "failed" because the server was
 * never in the run, so leaving the red card beside the notice puts two explanations on screen and
 * makes the wrong one louder.
 */
export const isExplainedByMcpNotice = (
    toolWireName: string,
    notices: readonly McpServerNotice[],
): boolean => {
    const server = mcpToolServerName(toolWireName)
    if (!server) return false
    return notices.some((notice) => notice.needsAuthorization && notice.serverName === server)
}
