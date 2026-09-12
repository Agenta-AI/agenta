import {useEffect, useRef} from "react"

import {useInlineRename} from "@agenta/sessions-ui"
import {message} from "@agenta/ui/app-message"
import {Input} from "@agenta/ui/ui"
import {PencilSimple} from "@phosphor-icons/react"

/**
 * The automation's identity: its name, renamed in place, and the description under it.
 *
 * Click-to-rename rather than a menu item — the name IS the control, so there is nothing to open.
 * Enter and blur both commit (the hook guards the double call), Escape leaves it alone. The input
 * carries the heading's own type and box so the swap into edit does not move the title.
 */
export const AutomationTitle = ({
    name,
    description,
    onRename,
    autoEdit = false,
    placeholder,
    fallback,
}: {
    name: string
    description: string
    onRename: (next: string) => Promise<boolean>
    /** Open in the editing state on mount — a new automation lands with its name to be typed. */
    autoEdit?: boolean
    /** The input's placeholder while the name is empty. */
    placeholder?: string
    /** Shown as the heading while the name is empty — the name this would be saved under. */
    fallback?: string
}) => {
    const rename = useInlineRename({
        current: name,
        // Errors are surfaced here so the hook's own fallback (which says "session") never fires.
        onCommit: async (next) => {
            try {
                const ok = await onRename(next)
                if (ok) message.success("Name updated")
                else message.error("Couldn't rename this automation")
            } catch {
                message.error("Couldn't rename this automation")
            }
            return true
        },
    })

    // Once, on mount: `start` is re-created whenever the name changes, so keying the effect on
    // it would drop the user back into editing after every rename.
    const started = useRef(false)
    const {start} = rename
    useEffect(() => {
        if (!autoEdit || started.current) return
        started.current = true
        start()
    }, [autoEdit, start])

    return (
        <div className="flex min-w-0 flex-col">
            {rename.renaming ? (
                <Input
                    autoFocus
                    aria-label="Automation name"
                    placeholder={placeholder}
                    value={rename.draft}
                    onChange={(event) => rename.setDraft(event.target.value)}
                    onBlur={() => void rename.commit()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") void rename.commit()
                        if (event.key === "Escape") rename.cancel()
                    }}
                    // A notch under the heading while editing, and a medium placeholder: a bold
                    // hint reads as a name already typed.
                    className="text-[16px] font-semibold placeholder:font-medium placeholder:text-muted-foreground focus-visible:border-input focus-visible:ring-0 md:text-[16px]"
                />
            ) : (
                <button
                    type="button"
                    onClick={rename.start}
                    title="Rename"
                    // No focus ring: the shared FOCUS_RING draws a hard near-black outline and
                    // the softer ring still glowed around the title. Hover carries the affordance.
                    className="group -ml-2 flex min-w-0 cursor-pointer items-center rounded-lg border-0 bg-transparent px-2 py-1 text-left text-foreground outline-none hover:bg-accent focus-visible:bg-accent"
                >
                    <h1
                        className={`m-0 min-w-0 truncate text-[18px] font-semibold leading-[1.25] tracking-[-0.02em] ${
                            name ? "" : "text-muted-foreground"
                        }`}
                    >
                        {name || fallback || placeholder}
                    </h1>
                    {/* Only on hover or keyboard focus: the name is the control, and a pencil
                        parked beside it permanently reads as part of the title. */}
                    <PencilSimple
                        aria-hidden
                        size={14}
                        className="ml-2 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                </button>
            )}
            {description ? (
                <p className="m-0 mt-1.5 text-[14px] leading-snug text-muted-foreground">
                    {description}
                </p>
            ) : null}
        </div>
    )
}
