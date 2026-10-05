/** The ⋯ "File access…" setting: the stored level and the dialog that changes it. */
import {useCallback, useState, useSyncExternalStore, type ReactNode} from "react"

import {type AppAccess} from "@agenta/entities/drive"

import {accessLabel, GrantSheet} from "./GrantSheet"
import {defaultGrants, effectiveAccess, type HtmlAppEnv} from "./HtmlAppBody"

export interface AppAccessMenu {
    /** The stored level as shown in the menu ("Read", "Not set", …). */
    label: string
    open: () => void
    /** The dialog; render it anywhere, it portals into the pane. */
    dialog: ReactNode
}

export function useAppAccessMenu({
    mountId,
    dir,
    displayDir,
    appName,
    env,
}: {
    /** Null when the selection is not an app: the hook stays inert. */
    mountId: string | null
    /** App dir, mount-relative: the grant's key. */
    dir: string
    /** The same folder as presented to the user. */
    displayDir: string
    appName: string
    env: HtmlAppEnv
}): AppAccessMenu {
    const grants = env.grants ?? defaultGrants
    const canEditMounts = env.canEditMounts ?? !!mountId
    // A string snapshot: the store hands out a fresh record object on every read.
    const stored = useSyncExternalStore(
        grants.subscribe,
        () => (mountId ? (grants.get(mountId, dir)?.level ?? "unset") : "unset"),
        () => "unset",
    )
    const level: AppAccess | null =
        stored === "unset" ? null : effectiveAccess(stored as AppAccess, canEditMounts)
    const [isOpen, setIsOpen] = useState(false)

    const save = useCallback(
        (next: AppAccess) => {
            setIsOpen(false)
            if (!mountId) return
            // Choosing read here is deliberate, so the app is not asked about writing again.
            grants.set(mountId, dir, {level: next, writeRefused: next === "read"})
        },
        [grants, mountId, dir],
    )

    return {
        label: accessLabel(level),
        open: useCallback(() => setIsOpen(true), []),
        dialog:
            isOpen && mountId ? (
                <GrantSheet
                    open
                    appName={appName}
                    dir={displayDir}
                    current={level}
                    canWrite={canEditMounts}
                    container={env.sheetContainer?.()}
                    onCancel={() => setIsOpen(false)}
                    onSave={save}
                />
            ) : null,
    }
}
