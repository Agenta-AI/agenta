/**
 * The playground addresses. Other features link to the playground through this file only, so it
 * imports nothing: a link must not pull playground code into the page that shows it.
 *
 * `base` is the project path, `/w/{workspace_id}/p/{project_id}`.
 */
export const playgroundHref = (
    base: string,
    appId: string,
    revisionIds: readonly string[] = [],
): string => {
    const path = `${base}/apps/${appId}/playground`
    return revisionIds.length > 0 ? `${path}?revisions=${revisionIds.join(",")}` : path
}

/** The evaluator playground for one evaluator revision. */
export const evaluatorPlaygroundHref = (base: string, revisionId: string): string =>
    `${base}/evaluators/playground?revisions=${revisionId}`

/** The revision ids in a `?revisions=` value, in order, each once. */
export const parseRevisionIds = (value: string | string[] | undefined): string[] =>
    typeof value === "string" ? [...new Set(value.split(",").filter(Boolean))] : []

/** The hash key of the playground snapshot, the same as /w so links work in both apps. */
export const SNAPSHOT_PARAM = "pgSnapshot"

/** `href` with an encoded playground snapshot in its hash. */
export const withSnapshot = (href: string, encoded: string): string =>
    `${href}#${SNAPSHOT_PARAM}=${encoded}`

/**
 * The encoded snapshot in a location hash, or null. Read by hand: `URLSearchParams` turns the `+`
 * of the lz-string alphabet into a space.
 */
export const readSnapshotParam = (hash: string): string | null => {
    const prefix = `${SNAPSHOT_PARAM}=`
    for (const part of hash.replace(/^#/, "").split("&")) {
        if (part.startsWith(prefix)) return part.slice(prefix.length) || null
    }
    return null
}
