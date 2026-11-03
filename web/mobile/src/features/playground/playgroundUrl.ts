/**
 * The prompt playground's address. Other features link to the playground through this file only,
 * so it imports nothing: a link must not pull playground code into the page that shows it.
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

/** The revision ids in a `?revisions=` value, in order. */
export const parseRevisionIds = (value: string | string[] | undefined): string[] =>
    typeof value === "string" ? value.split(",").filter(Boolean) : []
