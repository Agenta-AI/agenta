import {useInlineRename} from "@agenta/sessions-ui"
import {message} from "@agenta/ui/app-message"
import {PencilSimple} from "@phosphor-icons/react"

import {Input} from "@/components/ui/input"

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
        <div className="flex min-w-0 flex-col">
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
                />
            ) : (
                <button
                    type="button"
                    onClick={rename.start}
                    title="Rename"
                    // The shared FOCUS_RING is a hard 2px outline in the near-black ring colour,
                    // which reads as a border on a heading. The soft shadcn ring the inputs use is
                    // still keyboard-visible without looking like chrome.
                    className="-ml-2 flex min-w-0 items-center rounded-lg border-0 bg-transparent px-2 py-1 text-left text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                    <h1 className="m-0 min-w-0 truncate text-[18px] font-semibold leading-[1.25] tracking-[-0.02em]">
                        {name}
                    </h1>
                    <PencilSimple
                        aria-hidden
                        size={14}
                        className="ml-2 shrink-0 text-muted-foreground"
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
