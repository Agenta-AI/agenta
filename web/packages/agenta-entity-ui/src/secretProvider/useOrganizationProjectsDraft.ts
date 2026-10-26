import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    setOrganizationConnectionProjectsAtom,
    type OrganizationSecretProjects,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {message} from "@agenta/ui/app-message"
import {useSetAtom} from "jotai"

/** The toast an organization save shows: who may use the connection now. */
export const organizationSavedToast = (name: string, projects: OrganizationSecretProjects) => {
    const count = projects.projectIds.length
    return projects.availability === "all_projects"
        ? `${name} saved. Every project can use it.`
        : `${name} saved. ${count} ${count === 1 ? "project" : "projects"} can use it.`
}

/** The HTTP status of a failed save, when it carried one. */
const failedStatus = (error: unknown): number | null => {
    const statusCode = (error as {statusCode?: unknown} | null)?.statusCode
    if (typeof statusCode === "number") return statusCode
    const status = (error as {response?: {status?: unknown}} | null)?.response?.status
    return typeof status === "number" ? status : null
}

/** What a refused organization save says, in the design's words; null for any other failure. */
export const organizationSaveError = (error: unknown, org: string, name: string): string | null => {
    const status = failedStatus(error)
    if (status === 409) return `${org} already has a connection named ${name}. Pick another name.`
    if (status === 403) {
        return `You are no longer an owner or admin of ${org}, so you can't change organization connections.`
    }
    if (status === 422) {
        const body = (error as {body?: {detail?: unknown}} | null)?.body
        if (typeof body?.detail === "string" && body.detail.startsWith("Every project must")) {
            return `One of the selected projects is no longer in ${org}. Reload the page and pick again.`
        }
    }
    return null
}

export const sameProjects = (
    a: OrganizationSecretProjects,
    b: OrganizationSecretProjects,
): boolean =>
    a.availability === b.availability &&
    (a.availability === "all_projects" ||
        (a.projectIds.length === b.projectIds.length &&
            a.projectIds.every((id) => b.projectIds.includes(id))))

/**
 * The "Projects that can use it" choice of a subscription dialog: a draft seeded from the saved
 * connection each time the dialog opens, written on Done only when it changed.
 */
export const useOrganizationProjectsDraft = ({
    open,
    connection,
    enabled,
    organizationName = "",
}: {
    open: boolean
    connection: ProviderConnection | null | undefined
    enabled: boolean
    /** For the refusal messages that name the organization. */
    organizationName?: string
}) => {
    const setProjects = useSetAtom(setOrganizationConnectionProjectsAtom)
    const saved = useMemo<OrganizationSecretProjects>(
        () => ({
            availability: connection?.availability ?? "all_projects",
            projectIds: connection?.selectedProjectIds ?? [],
        }),
        [connection?.availability, connection?.selectedProjectIds],
    )
    const [projects, setDraft] = useState<OrganizationSecretProjects>(saved)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Seeded when the dialog opens or names another connection, never on a refetch of the same
    // one: a sign-in that lands must not undo projects picked while it ran.
    const seededFor = useRef<string | null>(null)
    useEffect(() => {
        if (!open) {
            seededFor.current = null
            return
        }
        const identity = connection?.id ?? ""
        if (seededFor.current === identity) return
        seededFor.current = identity
        setDraft(saved)
        setError(null)
    }, [open, connection?.id, saved])

    /** Write the draft if it changed, then close. A failure keeps the dialog open on its line. */
    const apply = useCallback(
        async (close: () => void) => {
            if (!enabled || !connection || sameProjects(saved, projects)) {
                close()
                return
            }
            setSaving(true)
            setError(null)
            try {
                await setProjects({connectionId: connection.id, projects})
                message.success(organizationSavedToast(connection.name, projects))
                close()
            } catch (failure) {
                setError(
                    organizationSaveError(failure, organizationName, connection.name) ||
                        `Agenta could not save this ${connection.name} connection. Try again.`,
                )
            } finally {
                setSaving(false)
            }
        },
        [connection, enabled, organizationName, projects, saved, setProjects],
    )

    return {projects, setProjects: setDraft, saved, saving, error, apply}
}
