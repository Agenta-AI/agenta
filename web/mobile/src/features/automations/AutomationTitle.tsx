import {useInlineRename} from "@agenta/sessions-ui"
import {message} from "@agenta/ui/app-message"
import {PencilSimple} from "@phosphor-icons/react"

import {Input} from "@/components/ui/input"
import {FOCUS_RING} from "@/lib/interactive"

/**
 * The automation's identity: its name, renamed in place, and the description under it.
 *
 * Click-to-rename rather than a menu item — the name IS the control, so there is nothing to open.
 * Enter and blur both commit (the hook guards the double call), Escape leaves it alone.
 */
export const AutomationTitle = ({
    name,
    description,
    onRename,
}: {
    name: string
    description: string
    onRename: (next: string) => Promise<boolean>
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

    return (
        <div className="flex min-w-0 flex-col gap-1">
            {rename.renaming ? (
                <Input
                    autoFocus
                    aria-label="Automation name"
                    value={rename.draft}
                    onChange={(event) => rename.setDraft(event.target.value)}
                    onBlur={() => void rename.commit()}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") void rename.commit()
                        if (event.key === "Escape") rename.cancel()
                    }}
                    className="h-auto py-0.5 text-xl font-semibold tracking-tight md:text-xl"
                />
            ) : (
                <button
                    type="button"
                    onClick={rename.start}
                    title="Rename"
                    className={`text-foreground -mx-1 flex min-w-0 items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left ${FOCUS_RING} hover:bg-accent`}
                >
                    <h1 className="m-0 min-w-0 truncate text-xl font-semibold tracking-tight">
                        {name}
                    </h1>
                    <PencilSimple
                        aria-hidden
                        size={14}
                        className="text-muted-foreground shrink-0"
                    />
                </button>
            )}
            {description ? (
                <p className="text-muted-foreground m-0 text-sm leading-snug">{description}</p>
            ) : null}
        </div>
    )
}
