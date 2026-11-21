import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    httpStatusOf,
    setOrganizationConnectionProjectsAtom,
    type OrganizationSecretProjects,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {createT} from "@agenta/i18n"
import organizationProjectsCatalog from "@agenta/i18n/catalogs/entityUi.organizationProjects"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {useSetAtom, useStore} from "jotai"

const t = createT(organizationProjectsCatalog)

interface QueuedWrite {
    write: Promise<boolean>
    projects: OrganizationSecretProjects
    /** Set when the write failed: what the view that opened meanwhile shows. */
    error?: string
}

// The newest write of each connection. Each write waits for the one before it, also across a
// closed and reopened view, so a choice made during a save is never lost or overwritten. A view
// that opens while one runs starts from its choice and shows how it ends.
const writeQueues = new Map<string, QueuedWrite>()

/** The toast an organization save shows: who may use the connection now. */
export const organizationSavedToast = (name: string, projects: OrganizationSecretProjects) => {
    const count = projects.projectIds.length
    return projects.availability === "all_projects"
        ? t("entityUi.organizationProjects.savedEveryProject", {name})
        : t("entityUi.organizationProjects.savedProjectsCount", {name, count})
}

/** The `code` of a refusal whose detail carries one. */
const refusalCode = (error: unknown): string | null => {
    const body = (error as {body?: {detail?: unknown}} | null)?.body
    const code = (body?.detail as {code?: unknown} | undefined)?.code
    return typeof code === "string" ? code : null
}

/**
 * What a refused organization write says when the refusal is the plan, the caller's role, or a project that
 * left the organization; null for any other failure, whose own message the caller shows.
 */
export const organizationRefusal = (error: unknown, org: string): string | null => {
    const status = httpStatusOf(error)
    if (status === 403 && refusalCode(error) === "project_limit_not_allowed") {
        return t("entityUi.organizationProjects.choosingProjectsPlan")
    }
    if (status === 403) {
        return t("entityUi.organizationProjects.noLongerOwner", {organization: org})
    }
    if (status === 422 && refusalCode(error) === "project_not_in_organization") {
        return t("entityUi.organizationProjects.projectNotInOrg", {organization: org})
    }
    return null
}

/**
 * What a refused save of a named organization connection says. A 409 there is its name taken;
 * the subscription paths send no name, so they read only `organizationRefusal`.
 */
export const organizationSaveError = (error: unknown, org: string, name: string): string | null =>
    httpStatusOf(error) === 409
        ? t("entityUi.organizationProjects.nameTaken", {organization: org, name})
        : organizationRefusal(error, org)

export const sameProjects = (
    a: OrganizationSecretProjects,
    b: OrganizationSecretProjects,
): boolean =>
    a.availability === b.availability &&
    (a.availability === "all_projects" ||
        (a.projectIds.length === b.projectIds.length &&
            a.projectIds.every((id) => b.projectIds.includes(id))))

/**
 * The "Projects that can use it" choice of a subscription view: a draft seeded from the saved
 * connection when the view opens, written by `apply` only when it changed.
 */
export const useOrganizationProjectsDraft = ({
    connection,
    enabled,
    organizationName = "",
}: {
    connection: ProviderConnection | null | undefined
    enabled: boolean
    /** For the refusal messages that name the organization. */
    organizationName?: string
}) => {
    const setProjects = useSetAtom(setOrganizationConnectionProjectsAtom)
    const store = useStore()
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

    // Seeded when the view opens or names another connection, never on a refetch of the same
    // one: a sign-in that lands must not undo projects picked while it ran.
    const seededFor = useRef<string | null>(null)
    // The last choice sent: a refetch of `saved` can lag behind a write that already landed.
    const written = useRef<OrganizationSecretProjects | null>(null)
    useEffect(() => {
        const identity = connection?.id ?? ""
        if (seededFor.current === identity) return
        seededFor.current = identity
        const queued = writeQueues.get(identity)
        written.current = queued?.projects ?? null
        setDraft(queued?.projects ?? saved)
        setError(null)
        setSaving(Boolean(queued))
        // The write of a closed view: this view shows it as saving, then its failure, if any.
        void queued?.write.then((ok) => {
            if (writeQueues.has(identity) || seededFor.current !== identity) return
            setSaving(false)
            if (ok) return
            written.current = null
            setError(queued.error ?? null)
        })
    }, [connection?.id, saved])

    /** Write the draft if it changed. Resolves false on a failure, which shows on its line. */
    const apply = useCallback((): Promise<boolean> => {
        if (!enabled || !connection || sameProjects(written.current ?? saved, projects)) {
            return Promise.resolve(true)
        }
        written.current = projects
        setSaving(true)
        const id = connection.id
        // The project is read now: the write may run after a switch to another one.
        const scope = store.get(projectIdAtom) ?? undefined
        const entry: QueuedWrite = {projects, write: Promise.resolve(true)}
        entry.write = (writeQueues.get(id)?.write ?? Promise.resolve(true)).then(async () => {
            // A newer choice is queued behind this one, so this one is not sent.
            if (writeQueues.get(id) !== entry) return true
            // The view may show another connection by now; its line is not this write's.
            const shown = () => seededFor.current === id
            if (shown()) setError(null)
            try {
                await setProjects({connectionId: id, projects, projectId: scope})
                message.success(organizationSavedToast(connection.name, projects))
                return true
            } catch (failure) {
                if (written.current === projects) written.current = null
                entry.error =
                    organizationRefusal(failure, organizationName) ||
                    t("entityUi.organizationProjects.couldNotSave", {name: connection.name})
                if (shown()) setError(entry.error)
                return false
            } finally {
                if (writeQueues.get(id) === entry) {
                    writeQueues.delete(id)
                    if (shown()) setSaving(false)
                }
            }
        })
        writeQueues.set(id, entry)
        return entry.write
    }, [connection, enabled, organizationName, projects, saved, setProjects, store])

    /** An existing connection whose projects the admin changed: Save can write them alone. */
    const changed = enabled && !!connection && !sameProjects(written.current ?? saved, projects)

    return {projects, setProjects: setDraft, saved, saving, error, changed, apply}
}
