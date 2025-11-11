import styles from "./assets/CodeBlockErrorIndicator.module.css"

/**
 * A visual indicator component that displays a warning icon
 * when there are validation errors in the code block.
 *
 * Renders a warning emoji (⚠️) with styling from CodeBlockErrorIndicator.module.css
 * that positions it in the top-right corner of the code block.
 *
 * @returns React component displaying the error indicator
 */
export function CodeBlockErrorIcon() {
    return (
        <div className={styles["code-block-error-indicator"]} title="Validation error">
            ⚠️
        </div>
    )
}
