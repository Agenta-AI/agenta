import React, {useEffect, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {Tooltip} from "antd"

/**
 * TokenTooltipPlugin
 *
 * Renders an Ant Design `Tooltip` anchored to an invalid template token
 * (e.g. `{{$.input.xx.abc}}` — `input` singular is not a known envelope
 * slot) when the user hovers it. Uses the data-* attributes TokenNode
 * publishes (`data-invalid`, `data-tooltip`, `data-tooltip-suggestion`)
 * so the presentation layer stays in React while the Lexical node itself
 * remains a plain TextNode — no conversion to DecoratorNode needed,
 * inline flow and cursor behavior preserved.
 *
 * Delegation pattern: a single mouseover/mouseout listener on the editor
 * root handles all tokens, which avoids per-node listeners and survives
 * Lexical's DOM reconciliation.
 */
export function TokenTooltipPlugin(): React.ReactElement | null {
    const [editor] = useLexicalComposerContext()
    const [target, setTarget] = useState<HTMLElement | null>(null)

    useEffect(() => {
        const rootEl = editor.getRootElement()
        if (!rootEl) return

        const onMouseOver = (e: MouseEvent) => {
            const node = (e.target as HTMLElement | null)?.closest<HTMLElement>(
                ".token-node[data-invalid='true']",
            )
            if (node) setTarget(node)
        }
        const onMouseOut = (e: MouseEvent) => {
            // Only clear when leaving a token (not moving within it).
            const from = e.target as HTMLElement | null
            const to = e.relatedTarget as HTMLElement | null
            if (
                from?.closest(".token-node[data-invalid='true']") &&
                !to?.closest(".token-node[data-invalid='true']")
            ) {
                setTarget(null)
            }
        }

        rootEl.addEventListener("mouseover", onMouseOver)
        rootEl.addEventListener("mouseout", onMouseOut)
        return () => {
            rootEl.removeEventListener("mouseover", onMouseOver)
            rootEl.removeEventListener("mouseout", onMouseOut)
        }
    }, [editor])

    // If the targeted node transitions from invalid → valid while the
    // cursor is still inside it (user typing through a bad intermediate
    // state), the mouseout listener never fires. Without this, the
    // Ant Tooltip stays open with stale content ("Empty placeholder."
    // from the transient `{{}}`). Observe the attribute on the target
    // and clear when it goes away.
    useEffect(() => {
        if (!target) return
        // Already stale on mount? Clear immediately.
        if (target.getAttribute("data-invalid") !== "true") {
            setTarget(null)
            return
        }
        const observer = new MutationObserver(() => {
            if (target.getAttribute("data-invalid") !== "true") {
                setTarget(null)
            }
        })
        observer.observe(target, {
            attributes: true,
            attributeFilter: ["data-invalid", "data-tooltip", "data-tooltip-suggestion"],
        })
        return () => observer.disconnect()
    }, [target])

    if (!target) return null

    const reason = target.getAttribute("data-tooltip") ?? "Invalid template placeholder."
    const suggestion = target.getAttribute("data-tooltip-suggestion")
    const content = (
        <div className="flex flex-col gap-1">
            <span>{reason}</span>
            {suggestion ? (
                <span>
                    Did you mean <code>{suggestion}</code>?
                </span>
            ) : null}
        </div>
    )

    return (
        <Tooltip
            open
            title={content}
            placement="top"
            // Anchor to the actual hovered DOM node, not a React child.
            getPopupContainer={() => target.ownerDocument.body}
        >
            {/*
             * Invisible sibling positioned over the hovered token.
             * `fixed` + getBoundingClientRect keeps the tooltip stable as
             * the editor scrolls or reflows during edits.
             */}
            <span
                style={{
                    position: "fixed",
                    left: target.getBoundingClientRect().left,
                    top: target.getBoundingClientRect().top,
                    width: target.getBoundingClientRect().width,
                    height: target.getBoundingClientRect().height,
                    pointerEvents: "none",
                }}
            />
        </Tooltip>
    )
}
