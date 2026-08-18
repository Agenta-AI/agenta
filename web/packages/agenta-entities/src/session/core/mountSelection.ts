/**
 * Picking the session's working-directory ("cwd") mount out of a session's mount list.
 */
import type {Mount} from "./schema"

/** The canonical mount name the backend stores for the session working directory. */
const CWD_MOUNT_NAME = "cwd"

/**
 * The session's working-directory mount, else the first mount.
 *
 * Matched on `name`: the wire `slug` is a minted reserved slug (`__ag__session__<uuid5>__cwd`), so
 * it never equals `"cwd"`. The slug-suffix pass is only a fallback for responses without a name.
 */
export function pickCwdMount(mounts: Mount[]): Mount | null {
    return (
        mounts.find((mount) => mount.name === CWD_MOUNT_NAME) ??
        mounts.find((mount) => Boolean(mount.slug?.endsWith(`__${CWD_MOUNT_NAME}`))) ??
        mounts[0] ??
        null
    )
}
