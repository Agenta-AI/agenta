import type {LexicalEditor} from "lexical"

/**
 * Show a loading overlay on the editor during heavy operations (large paste,
 * initial content hydration, etc.).
 *
 * Uses direct DOM manipulation so it can be shown synchronously before
 * deferring heavy work to the next frame.
 *
 * @returns A cleanup function that removes the overlay, or null if no host was found.
 */
export function showEditorLoadingOverlay(
    editor: LexicalEditor,
    message = "Processing large content\u2026",
): (() => void) | null {
    const rootElement = editor.getRootElement()
    if (!rootElement) return null

    // Find a host container that represents the visible editor surface.
    // Prefer the editor's own shell so loading states stay scoped to the
    // active input instead of blanketing the surrounding panel/section.
    let host: HTMLElement | null = null

    // 1. Shared editor shell — includes header, controls, and content area.
    host = rootElement.closest(".agenta-shared-editor") as HTMLElement | null

    // 2. Editor wrapper inside the shell.
    if (!host) {
        host = rootElement.closest(".agenta-editor-wrapper") as HTMLElement | null
    }

    // 3. Prefer the nearest scrollable editor ancestor before escalating
    //    to larger containers.
    if (!host) {
        let current = rootElement.parentElement
        while (current) {
            const overflow = getComputedStyle(current).overflowY
            if (overflow === "auto" || overflow === "scroll") {
                host = current
                break
            }
            current = current.parentElement
        }
    }

    // 4. If the editor lives inside a modal and no local shell exists,
    //    fall back to the modal body.
    if (!host) {
        host = rootElement.closest(".ant-modal-body") as HTMLElement | null
    }

    // 5. Final fallback to the immediate parent.
    if (!host) {
        host = rootElement.parentElement
    }

    if (!host) return null

    // Ensure position context
    const computedPos = getComputedStyle(host).position
    const needsPositionFix = !computedPos || computedPos === "static"
    if (needsPositionFix) {
        host.style.position = "relative"
    }

    const overlay = document.createElement("div")
    overlay.className = "agenta-paste-overlay"
    overlay.innerHTML = `
        <div class="agenta-paste-overlay-content">
            <div class="agenta-paste-spinner"></div>
            <span>${message}</span>
        </div>
    `
    host.appendChild(overlay)

    return () => {
        overlay.remove()
        if (needsPositionFix) {
            host!.style.position = ""
        }
    }
}
