export {expect, type Locator} from "@playwright/test"

/**
 * Runs a Playwright locator boolean check (isEnabled, isVisible, isChecked, ...)
 * meant to be polled until true. Swallows "not there yet" failures so the poll can
 * keep retrying, but rethrows a strict-mode violation — the locator matched more
 * than one element — because that means the selector itself is broken and no amount
 * of polling will fix it. Left unguarded, `.catch(() => false)` turns that error into
 * a permanent `false`, and the poll times out with a message that names no real cause
 * (e.g. "page never reached a stable ready state") instead of the actual selector bug.
 */
export async function pollLocatorState(check: () => Promise<boolean>): Promise<boolean> {
    try {
        return await check()
    } catch (error) {
        if (error instanceof Error && /strict mode violation/i.test(error.message)) {
            throw error
        }
        return false
    }
}
