/** Move browser preferences only between the current account's two known identities. */
export const migrateSessionPreferences = (sessionUserId: string, profileUid: string) => {
    if (
        typeof window === "undefined" ||
        !sessionUserId ||
        !profileUid ||
        sessionUserId === profileUid
    )
        return

    try {
        const storage = window.localStorage
        const keys = Array.from({length: storage.length}, (_, index) => storage.key(index))
        for (const key of keys) {
            if (!key) continue
            let target: string | null = null
            for (const prefix of ["agenta:onboarding:", "agenta:settings:"]) {
                const sourcePrefix = `${prefix}${sessionUserId}:`
                if (key.startsWith(sourcePrefix)) {
                    target = `${prefix}${profileUid}:${key.slice(sourcePrefix.length)}`
                    break
                }
            }
            for (const prefix of [
                "agenta:observability:has-received-traces:",
                "agenta:observability:has-received-sessions:",
            ]) {
                if (key === `${prefix}${sessionUserId}`) target = `${prefix}${profileUid}`
            }
            if (!target) continue
            const value = storage.getItem(key)
            if (value === null) continue
            // A choice already saved by /m wins over the old desktop preference.
            if (storage.getItem(target) === null) {
                storage.setItem(target, value)
                // Notify atoms already mounted under the canonical scope in this tab.
                window.dispatchEvent(
                    new StorageEvent("storage", {
                        key: target,
                        newValue: value,
                        storageArea: storage,
                    }),
                )
            }
            storage.removeItem(key)
        }
    } catch {
        // Storage can be unavailable; retain any legacy keys that could not be copied.
    }
}
