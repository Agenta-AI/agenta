/**
 * Where an API-key connection's credential goes, and what the relay writes in front of it.
 *
 * Mirrors `MCPCredentialBinding` in `api/oss/src/core/gateways/mcps/dtos.py`, and the relay's
 * rendering in `providers/http/adapter.py::injected_credentials`. The preview line on the key
 * screen is built here from the same rule, so what the screen says is sent is what is sent.
 */
import {mcpDefaultKeyHeader} from "./probeResponse"
import type {MCPCredentialBinding, MCPServerProbe} from "./types"

/** What a connection with no binding sends, which is also the commonest server's shape. */
export const MCP_DEFAULT_CREDENTIAL_BINDING: MCPCredentialBinding = {
    kind: "header",
    name: "Authorization",
    prefix: "Bearer",
}

/** Stands in for the secret wherever the screen shows what is sent. */
const MASKED_CREDENTIAL = "••••"

/**
 * The binding the key screen starts with, from what the probe found.
 *
 * The header follows `mcpDefaultKeyHeader`. A scheme travels in `Authorization`, so that
 * header starts with the Bearer prefix; any other header carries the bare value.
 */
export function mcpDefaultCredentialBinding(
    probe: MCPServerProbe | null | undefined,
): MCPCredentialBinding {
    const name = mcpDefaultKeyHeader(probe)
    return name === MCP_DEFAULT_CREDENTIAL_BINDING.name
        ? MCP_DEFAULT_CREDENTIAL_BINDING
        : {kind: "header", name, prefix: null}
}

/** The binding as the API stores it: names trimmed, and a blank prefix is no prefix. */
export function normalizeCredentialBinding(binding: MCPCredentialBinding): MCPCredentialBinding {
    const prefix = binding.prefix?.trim()
    return {kind: binding.kind, name: binding.name.trim(), prefix: prefix || null}
}

/** The value as the relay renders it: the prefix, a space, the secret. */
const renderedValue = (binding: MCPCredentialBinding, secret: string): string => {
    const {prefix} = normalizeCredentialBinding(binding)
    return prefix ? `${prefix} ${secret}` : secret
}

/**
 * What the relay sends, with the secret masked: `Authorization: Basic ••••`, or
 * `?exaApiKey=••••`. Null while the binding has no name, because nothing is sent then.
 */
export function credentialBindingPreview(binding: MCPCredentialBinding): string | null {
    const name = binding.name.trim()
    if (!name) return null
    const value = renderedValue(binding, MASKED_CREDENTIAL)
    return binding.kind === "query" ? `?${name}=${value}` : `${name}: ${value}`
}

/**
 * The value of an `Authorization: Basic` credential: `username:password`, base64-encoded once.
 *
 * UTF-8 before base64, as RFC 7617 recommends, because `btoa` alone refuses any character
 * outside Latin-1 and a password can hold one.
 */
export function basicCredentialValue(username: string, password: string): string {
    const bytes = new TextEncoder().encode(`${username}:${password}`)
    return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
}
