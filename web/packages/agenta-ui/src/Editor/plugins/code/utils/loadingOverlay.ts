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

    // Find a host container that represents the visible area the user sees.
    // Priority: modal body (stable size) > editor wrapper > scrollable ancestor.
    let host: HTMLElement | null = null

    // 1. Prefer Ant Design modal body — it has a known, stable size even
    //    before the paste inflates the editor content.
    host = rootElement.closest(".ant-modal-body") as HTMLElement | null

    // 2. Editor wrapper — always present, already has position:relative,
    //    and scoping the overlay to the editor is better UX than covering
    //    the entire page when the editor is inside a scrollable ancestor.
    //    However, after a bulk-clear the wrapper may be tiny (single empty line),
    //    so fall through to a scrollable ancestor when the wrapper is too short.
    if (!host) {
        const wrapper = rootElement.closest(".agenta-editor-wrapper") as HTMLElement | null
        if (wrapper && wrapper.offsetHeight >= 100) {
            host = wrapper
        }
    }

    // 3. Try the nearest ancestor with overflow-y scrolling
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

    // 4. Final fallback to editor wrapper or parent element
    if (!host) {
        host =
            (rootElement.closest(".agenta-editor-wrapper") as HTMLElement) ||
            rootElement.parentElement
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
