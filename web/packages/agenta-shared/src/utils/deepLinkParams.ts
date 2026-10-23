/** The URL mirrors the drive selection and the open automation; the atoms stay the source of truth. */

/** `?drive=<path>` a file, `?drive=<path>/` a folder, `?drive=/` the root. */
export const DRIVE_QUERY_PARAM = "drive"

/** `?automation=<id>`, the same id the `/automations/<id>` page takes. */
export const AUTOMATION_QUERY_PARAM = "automation"

export interface DriveLinkTarget {
    /** Drive-root-relative presented path; "" is the root. */
    path: string
    /** A lazy drive reads an unloaded path as a file; the trailing slash says otherwise. */
    folder: boolean
}

export const formatDriveParam = ({path, folder}: DriveLinkTarget): string =>
    folder ? `${path}/` : path

export const parseDriveParam = (value: string | null): DriveLinkTarget | null => {
    if (value == null) return null
    const path = value.replace(/^\/+/, "").replace(/\/+$/, "")
    return {path, folder: path === "" || value.endsWith("/")}
}

/** `href` as a path with `name` set (or removed on null); slashes stay readable. */
export const withQueryParam = (href: string, name: string, value: string | null): string => {
    const url = new URL(href)
    if (value == null) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
    return `${url.pathname}${url.search.replace(/%2F/gi, "/")}${url.hash}`
}

export const readQueryParam = (name: string): string | null =>
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(name)

export const shareUrlWithQueryParam = (name: string, value: string): string =>
    typeof window === "undefined"
        ? ""
        : `${window.location.origin}${withQueryParam(window.location.href, name, value)}`

/** `replaceState`, not the router: a folder click must not re-render every `useRouter` consumer. */
export const replaceQueryParam = (name: string, value: string | null): void => {
    if (typeof window === "undefined") return
    if (readQueryParam(name) === value) return
    const path = withQueryParam(window.location.href, name, value)
    const state: unknown = window.history.state
    // Next restores a Back from the entry's `as`, so it moves with the URL.
    const nextState =
        state && typeof state === "object" && "as" in state ? {...state, as: path} : state
    window.history.replaceState(nextState, "", path)
}
