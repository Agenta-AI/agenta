/**
 * The outcome of one sharing write, as the sharing components read it. The host maps the API
 * error to it (`sharingWriteResultFromError`), so the components never parse an HTTP error.
 */
import type {DisclosedConnection, ShareDisclosure} from "@agenta/entities/sharing"

export type SharingWriteResult =
    | "ok"
    | "conflict"
    | "invalid_grantee"
    | "owner_active"
    | "not_shareable"
    | "failed"

const CODE_RESULTS: Record<string, SharingWriteResult> = {
    sharing_conflict: "conflict",
    invalid_grantee: "invalid_grantee",
    invalid_transfer_target: "invalid_grantee",
    owner_active: "owner_active",
    session_not_shareable: "not_shareable",
}

/** Reads the `detail.code` of a Fern `AgentaApiError` body; anything else is "failed". */
export const sharingWriteResultFromError = (error: unknown): SharingWriteResult => {
    const body = (error as {body?: unknown} | null)?.body
    const detail = (body as {detail?: unknown} | null | undefined)?.detail
    const code = (detail as {code?: unknown} | null | undefined)?.code
    return (typeof code === "string" && CODE_RESULTS[code]) || "failed"
}

/** Title-cases a provider slug; hosts pass a catalog label instead when they have one. */
export const defaultProviderLabel = (connection: DisclosedConnection): string =>
    connection.provider
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word, index) => (index === 0 ? word[0].toUpperCase() + word.slice(1) : word))
        .join(" ")

/** The distinct provider display names of a disclosure, in their first order. */
export const disclosureAccountNames = (
    disclosure: ShareDisclosure | null | undefined,
    providerLabel: (connection: DisclosedConnection) => string = defaultProviderLabel,
): string[] => {
    const names: string[] = []
    for (const connection of disclosure?.connections ?? []) {
        const name = providerLabel(connection)
        if (name && !names.includes(name)) names.push(name)
    }
    return names
}
