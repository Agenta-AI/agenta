import {useState} from "react"

import {Button, Textarea} from "@agenta/ui/ui"

/** Paste a license key and add it. */
export const LicenseKeyForm = ({
    pending,
    error,
    onSubmit,
}: {
    pending: boolean
    error: string | null
    onSubmit: (key: string) => void
}) => {
    const [key, setKey] = useState("")
    const trimmed = key.trim()

    return (
        <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
                event.preventDefault()
                if (trimmed) onSubmit(trimmed)
            }}
        >
            <label className="flex flex-col gap-1.5">
                <span className="text-foreground text-sm font-medium">License key</span>
                <Textarea
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    rows={3}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="agenta_license_v1..."
                    className="font-mono text-xs"
                />
            </label>
            {error ? <p className="text-colorError m-0 text-sm">{error}</p> : null}
            <Button type="submit" className="self-start" disabled={!trimmed || pending}>
                {pending ? "Adding…" : "Add key"}
            </Button>
        </form>
    )
}
