/**
 * Utility for creating styled console loggers for debugging and development.
 * Provides a consistent logging format across components with customizable styling.
 */

/**
 * Configuration options for the logger's visual appearance and behavior.
 *
 * @property componentColor - CSS color string for the component name (default: cyan)
 * @property eventColor - CSS color string for the event name (default: yellow)
 * @property disabled - If true, suppresses all logging output
 */
export interface LoggerOptions {
    componentColor?: string
    eventColor?: string
    disabled?: boolean
}

/**
 * Default color scheme for the logger.
 * Uses bold, distinctive colors to make different parts of the log easily distinguishable.
 */
const defaultColors: LoggerOptions = {
    componentColor: "color: cyan; font-weight: bold;",
    eventColor: "color: yellow; font-weight: bold;",
}

/**
 * Creates a styled logger function for a specific component.
 *
 * The logger provides a consistent format:
 * [timestamp] ComponentName - EventName (optional payload)
 *
 * Example usage:
 * ```typescript
 * const log = createLogger('SyntaxHighlight')
 * log('tokenizing', { line: 1, content: 'code' })
 * // Output: [2025-03-25T16:40:22.123Z] SyntaxHighlight - tokenizing { line: 1, content: 'code' }
 * ```
 *
 * Features:
 * - Consistent timestamp prefix
 * - Color-coded component and event names
 * - Optional payload logging
 * - Can be disabled via options
 * - Uses CSS styling for console output
 *
 * @param componentName - Name of the component using the logger
 * @param options - Optional configuration for colors and logging behavior
 * @returns A logging function that takes an event name and optional payload
 */
export function createLogger(componentName: string, options?: LoggerOptions) {
    // Merge default colors with provided options
    const {componentColor, eventColor} = {...defaultColors, ...options}

    // Return a closure that maintains the component context
    return (eventName: string, payload?: unknown) => {
        if (options?.disabled) return
        const timestamp = new Date().toISOString()
        if (payload !== undefined) {
            // Log with payload
            console.log(
                `%c[${timestamp}] %c${componentName}%c - %c${eventName}`,
                "color: gray;",
                componentColor,
                "color: inherit;",
                eventColor,
                payload,
            )
        } else {
            // Log without payload
            console.log(
                `%c[${timestamp}] %c${componentName}%c - %c${eventName}`,
                "color: gray;",
                componentColor,
                "color: inherit;",
                eventColor,
            )
        }
    }
}
