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
}: {
    open: boolean
    connection: ProviderConnection | null | undefined
    enabled: boolean
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
            } catch {
                setError(`Agenta could not save this ${connection.name} connection. Try again.`)
            } finally {
                setSaving(false)
            }
        },
        [connection, enabled, projects, saved, setProjects],
    )

    return {projects, setProjects: setDraft, saved, saving, error, apply}
}
