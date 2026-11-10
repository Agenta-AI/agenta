import {useId, useState} from "react"

import {CollapseCaret, SkeletonBlock} from "@agenta/ui/ui"
import dynamic from "next/dynamic"

// The editor loads when a reader opens the JSON, not with the page.
const ConfigJsonViewer = dynamic(
    () => import("./ConfigJsonViewer").then((module) => module.ConfigJsonViewer),
    {ssr: false, loading: () => <SkeletonBlock className="h-32 w-full rounded-md" />},
)

/** A "JSON" toggle that shows a stored value read only. */
export const ConfigJsonDisclosure = ({
    value,
    defaultOpen = false,
}: {
    value: unknown
    defaultOpen?: boolean
}) => {
    const [open, setOpen] = useState(defaultOpen)
    const id = useId()
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => setOpen((current) => !current)}
                className="m-0 inline-flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
                <CollapseCaret open={open} size={14} />
                JSON
            </button>
            {open ? (
                <div id={id} className="min-w-0">
                    <ConfigJsonViewer id={`config-json-${id.replace(/\W/g, "")}`} value={value} />
                </div>
            ) : null}
        </div>
    )
}
