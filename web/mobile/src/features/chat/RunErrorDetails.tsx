import {useState} from "react"

/** The raw error text, a tap away. */
export const RunErrorDetails = ({raw}: {raw: string | null}) => {
    const [open, setOpen] = useState(false)
    if (!raw) return null
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorTextTertiary underline-offset-4 hover:underline"
            >
                {open ? "Hide details" : "Details"}
            </button>
            {open ? (
                <pre className="ag-surface-inset m-0 mt-1 max-h-48 w-full overflow-auto whitespace-pre-wrap break-words rounded px-3 py-2 font-mono text-[12px] leading-relaxed text-colorTextSecondary">
                    {raw}
                </pre>
            ) : null}
        </>
    )
}
