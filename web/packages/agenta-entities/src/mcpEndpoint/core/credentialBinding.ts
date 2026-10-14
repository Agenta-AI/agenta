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

/** Where a `url` binding's value goes in the stored address (`URL_SECRET_PLACEHOLDER`). */
export const MCP_URL_SECRET_PLACEHOLDER = "{secret}"

/** The binding for an address that holds the placeholder. */
export const MCP_URL_CREDENTIAL_BINDING: MCPCredentialBinding = {kind: "url"}

export const hasUrlSecretPlaceholder = (url: string): boolean =>
    url.includes(MCP_URL_SECRET_PLACEHOLDER)

/**
 * Whether the address and the binding agree about the placeholder, as the API requires:
 * exactly one `{secret}` for a `url` binding, and none for any other.
 */
export function urlMatchesCredentialBinding(url: string, binding: MCPCredentialBinding): boolean {
    const count = url.split(MCP_URL_SECRET_PLACEHOLDER).length - 1
    return binding.kind === "url" ? count === 1 : count === 0
}

/** Whether the binding says where the value goes: a name, or the URL's placeholder. */
export const credentialBindingComplete = (binding: MCPCredentialBinding): boolean =>
    binding.kind === "url" || !!binding.name?.trim()

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

/**
 * The binding as the API stores it: names trimmed, and a blank prefix is no prefix. A query
 * binding takes no prefix, because a scheme word in a query value would be part of the key.
 */
export function normalizeCredentialBinding(binding: MCPCredentialBinding): MCPCredentialBinding {
    // The placeholder says where the value goes, so a url binding has nothing to name.
    if (binding.kind === "url") return MCP_URL_CREDENTIAL_BINDING
    const prefix = binding.kind === "header" ? binding.prefix?.trim() : null
    return {kind: binding.kind, name: binding.name?.trim() ?? "", prefix: prefix || null}
}

/** The value as the relay renders it: the prefix, a space, the secret. */
const renderedValue = (binding: MCPCredentialBinding, secret: string): string => {
    const {prefix} = normalizeCredentialBinding(binding)
    return prefix ? `${prefix} ${secret}` : secret
}

/**
 * What the relay sends, with the secret masked: `Authorization: Basic ••••`, or
 * `?exaApiKey=••••`. Null while the binding has no name, because nothing is sent then, and
 * for a url binding, whose address the screen shows instead.
 */
export function credentialBindingPreview(binding: MCPCredentialBinding): string | null {
    const name = binding.kind === "url" ? "" : (binding.name?.trim() ?? "")
    if (!name) return null
    const value = renderedValue(binding, MASKED_CREDENTIAL)
    return binding.kind === "query" ? `?${name}=${value}` : `${name}: ${value}`
}

/**
 * The URL to store for a connection: without the query parameter the binding fills.
 *
 * A pasted address can already carry the key (`?exaApiKey=...`). The relay adds the bound
 * parameter at request time, so the stored URL drops it, and the API refuses a stored URL
 * that still carries it.
 */
export function withoutCredentialParameter(
    url: string,
    binding: MCPCredentialBinding | null | undefined,
): string {
    const name = binding?.kind === "query" ? (binding.name?.trim() ?? "") : ""
    if (!name) return url
    try {
        const parsed = new URL(url)
        if (!parsed.searchParams.has(name)) return url
        parsed.searchParams.delete(name)
        return parsed.toString()
    } catch {
        return url
    }
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
