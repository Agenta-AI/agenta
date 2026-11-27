// utils/pluginLocks.ts

/**
 * Set to track which plugins are currently locked.
 * Used to prevent concurrent updates that could conflict.
 */
const pluginLocks = new Set<string>()

/**
 * Lock a plugin to prevent concurrent operations.
 *
 * Call this before starting a plugin operation that should not
 * be interrupted by another instance of the same plugin.
 *
 * @param name - Name of the plugin to lock
 */
export function lockPlugin(name: string) {
    pluginLocks.add(name)
}

/**
 * Unlock a plugin to allow new operations.
 *
 * Call this after completing a plugin operation to allow
 * new operations from the same plugin to proceed.
 *
 * @param name - Name of the plugin to unlock
 */
export function unlockPlugin(name: string) {
    pluginLocks.delete(name)
}

/**
 * Check if a plugin is currently locked.
 *
 * Plugins use locks to prevent concurrent updates that could lead to
 * race conditions or inconsistent state. For example, syntax highlighting
 * should not run while another highlighting operation is in progress.
 *
 * @param name - Name of the plugin to check
 * @returns True if the plugin is locked
 */
export function isPluginLocked(name: string): boolean {
    return pluginLocks.has(name)
}

/**
 * Execute a function with a plugin lock, ensuring unlock on completion.
 *
 * This helper automatically handles locking and unlocking around a function,
 * even if the function throws an error. Use this to ensure locks are always
 * properly released.
 *
 * @param name - Name of the plugin to lock
 * @param fn - Function to execute while plugin is locked
 */
export function runWithPluginLock(name: string, fn: () => void) {
    lockPlugin(name)
    try {
        fn()
    } finally {
        unlockPlugin(name)
    }
}

/**
 * Execute a function with a plugin lock and return its value.
 *
 * Similar to runWithPluginLock but allows returning a value from the function.
 * Useful when you need to compute or retrieve data while holding a lock.
 * Lock is released even if function throws.
 *
 * @param name - Name of the plugin to lock
 * @param fn - Function to execute while plugin is locked
 * @returns Value returned by the function
 */
export function withPluginLock<T>(name: string, fn: () => T): T {
    lockPlugin(name)
    try {
        return fn()
    } finally {
        unlockPlugin(name)
    }
} // added variant that returns a value
