/** The token composer's contenteditable surface: `{{selector}}` segments render as chips. */
import {useCallback, useEffect, useRef, type ReactNode} from "react"

import {splitTemplate} from "@agenta/entities/gatewayTrigger"

// Pill-style composer: a contenteditable where `{{token}}` segments render as inline,
// atomic chips (friendly labels). Source of truth is the template string; it re-renders
// the DOM only when `value` changes from outside (not on the user's own keystrokes).
export function PillEditor({
    value,
    onChange,
    insertApi,
    labelFor,
    footer,
}: {
    value: string
    onChange: (next: string) => void
    /** `insert(selector)` puts a pill at the caret, or at the end when the box is not focused. */
    insertApi?: React.MutableRefObject<{insert: (selector: string) => void} | null>
    /** The label a pill shows for its selector. */
    labelFor: (selector: string) => string
    /** Shown inside the box, under the text, so the two read as one control. */
    footer?: ReactNode
}) {
    const ref = useRef<HTMLDivElement>(null)
    const lastSerialized = useRef<string>("")

    const makePill = useCallback(
        (selector: string) => {
            const inner = selector.startsWith("$.") ? selector.slice(2) : selector
            const label = labelFor(selector)
            const span = document.createElement("span")
            span.dataset.token = inner
            span.contentEditable = "false"
            span.className =
                "mx-0.5 inline-flex select-none items-center gap-1 rounded-md border border-solid border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
            span.appendChild(document.createTextNode(label))
            const remove = document.createElement("button")
            remove.type = "button"
            remove.dataset.remove = ""
            remove.ariaLabel = `Remove ${label}`
            remove.className =
                "cursor-pointer border-0 bg-transparent p-0 text-xs leading-none text-inherit opacity-70 hover:opacity-100"
            remove.textContent = "×"
            span.appendChild(remove)
            return span
        },
        [labelFor],
    )

    const render = useCallback(
        (tpl: string) => {
            const el = ref.current
            if (!el) return
            el.innerHTML = ""
            for (const seg of splitTemplate(tpl)) {
                if (seg.literal != null) {
                    seg.literal.split("\n").forEach((part, i) => {
                        if (i > 0) el.appendChild(document.createElement("br"))
                        if (part) el.appendChild(document.createTextNode(part))
                    })
                } else if (seg.selector != null) {
                    el.appendChild(makePill(seg.selector))
                }
            }
        },
        [makePill],
    )

    const serialize = useCallback((el: HTMLElement): string => {
        let out = ""
        el.childNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? ""
            else if (node instanceof HTMLElement) {
                if (node.dataset.token != null) out += `{{${node.dataset.token}}}`
                else if (node.tagName === "BR") out += "\n"
                else out += "\n" + serialize(node)
            }
        })
        return out
    }, [])

    useEffect(() => {
        if (value !== lastSerialized.current) {
            render(value)
            lastSerialized.current = value
        }
    }, [value, render])

    const commit = useCallback(() => {
        const el = ref.current
        if (!el) return
        const next = serialize(el)
        lastSerialized.current = next
        onChange(next)
    }, [serialize, onChange])

    // Insert plain text at the caret, newlines as <br> (what `serialize` reads back).
    const insertText = useCallback((text: string) => {
        const sel = window.getSelection()
        if (!sel?.rangeCount) return
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const frag = document.createDocumentFragment()
        text.replace(/\r\n?/g, "\n")
            .split("\n")
            .forEach((line, i) => {
                if (i > 0) frag.appendChild(document.createElement("br"))
                if (line) frag.appendChild(document.createTextNode(line))
            })
        const last = frag.lastChild
        range.insertNode(frag)
        if (!last) return
        range.setStartAfter(last)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
    }, [])

    // The template is plain text plus atomic pills; pasted markup would both corrupt
    // `serialize` and inject live nodes into the editor.
    const onPaste = useCallback(
        (e: React.ClipboardEvent) => {
            e.preventDefault()
            insertText(e.clipboardData.getData("text/plain"))
            commit()
        },
        [insertText, commit],
    )

    useEffect(() => {
        if (!insertApi) return
        insertApi.current = {
            insert: (selector: string) => {
                const el = ref.current
                if (!el) return
                el.focus()
                const sel = window.getSelection()
                const pill = makePill(selector)
                const space = document.createTextNode(" ")
                let range: Range
                if (sel?.rangeCount && el.contains(sel.anchorNode)) {
                    range = sel.getRangeAt(0)
                    range.deleteContents()
                } else {
                    range = document.createRange()
                    range.selectNodeContents(el)
                    range.collapse(false)
                }
                range.insertNode(space)
                range.insertNode(pill)
                range.setStartAfter(space)
                range.collapse(true)
                sel?.removeAllRanges()
                sel?.addRange(range)
                commit()
            },
        }
        return () => {
            insertApi.current = null
        }
    }, [insertApi, makePill, commit])

    // The pill's × removes the pill, like Backspace does.
    const onClick = (e: React.MouseEvent) => {
        const remove = (e.target as HTMLElement).closest("[data-remove]")
        if (!remove) return
        e.preventDefault()
        remove.parentElement?.remove()
        commit()
    }

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "Enter") return
        e.preventDefault()
        insertText("\n")
        commit()
    }

    return (
        <div className="box-border w-full rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-[var(--ag-colorBgContainer)] focus-within:border-[var(--ag-colorPrimary)]">
            <div
                ref={ref}
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-multiline="true"
                onInput={commit}
                onPaste={onPaste}
                onKeyDown={onKeyDown}
                onClick={onClick}
                className="box-border max-h-[280px] min-h-[88px] w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-base leading-relaxed text-foreground outline-none md:text-sm"
            />
            {footer ? <div className="px-3 pb-2">{footer}</div> : null}
        </div>
    )
}
