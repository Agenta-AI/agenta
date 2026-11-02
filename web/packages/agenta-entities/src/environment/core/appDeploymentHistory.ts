import type {EnvironmentRevision} from "./schema"

interface AppReference {
    application?: {id?: string | null; slug?: string | null}
    application_variant?: {id?: string | null; slug?: string | null}
    application_revision?: {id?: string | null; version?: string | null}
}

export interface AppDeploymentApp {
    id: string
    slug: string | null
}

/** One deployment event of one app in one environment. */
export interface AppDeploymentRow {
    envRevisionId: string
    environmentId: string
    /** The app revision this event deployed. */
    deployedRevisionId: string | null
    deployedRevisionVersion: number | null
    variantId: string | null
    variantSlug: string | null
    appSlug: string | null
    /** 1-based and counted per app: the newest deployment has the highest number. */
    index: number
    message: string | null
    createdAt: string | null
    authorId: string | null
}

const findAppReference = (revision: EnvironmentRevision, app: AppDeploymentApp) => {
    const references = revision.data?.references as Record<string, AppReference> | null | undefined
    if (!references) return null
    for (const reference of Object.values(references)) {
        if (reference?.application?.id === app.id) return reference
        if (app.slug && reference?.application?.slug === app.slug) return reference
    }
    return null
}

/**
 * The deployment history of one app, from the revisions of one environment (newest first).
 *
 * An environment revision is kept when it holds a reference to the app, matched by id and then by
 * slug. A revision that only carries the app's unchanged reference forward (another app was
 * deployed) is dropped: a row is a real deployment event of this app, so it stays only when the
 * deployed app revision differs from the next older one.
 */
export const buildAppDeploymentHistory = (
    revisions: readonly EnvironmentRevision[],
    app: AppDeploymentApp,
): AppDeploymentRow[] => {
    const matches = revisions
        .filter((revision) => (revision.version ?? 0) > 0)
        .map((revision) => ({revision, reference: findAppReference(revision, app)}))
        .filter(
            (entry): entry is {revision: EnvironmentRevision; reference: AppReference} =>
                entry.reference !== null,
        )

    const events = matches.filter((entry, position) => {
        const older = matches[position + 1]
        const olderId = older?.reference.application_revision?.id ?? null
        return (entry.reference.application_revision?.id ?? null) !== olderId
    })

    return events.map(({revision, reference}, position) => {
        const version = reference.application_revision?.version
        return {
            envRevisionId: revision.id,
            environmentId: revision.environment_id ?? "",
            deployedRevisionId: reference.application_revision?.id ?? null,
            deployedRevisionVersion: version != null ? Number(version) : null,
            variantId: reference.application_variant?.id ?? null,
            variantSlug: reference.application_variant?.slug ?? null,
            appSlug: reference.application?.slug ?? null,
            index: events.length - position,
            message: revision.message ?? null,
            createdAt: revision.created_at ?? null,
            authorId: revision.author ?? revision.created_by_id ?? null,
        }
    })
}
