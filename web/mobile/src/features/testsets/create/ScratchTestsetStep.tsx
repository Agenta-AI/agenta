import {useState} from "react"

import {Button, DialogFooter, Input} from "@agenta/ui/ui"
import {useRouter} from "next/router"

/**
 * The name step of "Create from scratch". Nothing is saved here: the new test set page opens with
 * the name and saves at its first commit.
 */
export const ScratchTestsetStep = ({base, onClose}: {base: string; onClose: () => void}) => {
    const router = useRouter()
    const [name, setName] = useState("")
    const trimmed = name.trim()

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault()
                if (!trimmed) return
                void router.push(`${base}/testsets/new?name=${encodeURIComponent(trimmed)}`)
                onClose()
            }}
        >
            <div className="flex flex-col gap-1.5">
                <label htmlFor="scratch-testset-name" className="text-sm font-medium">
                    Test set name
                </label>
                <Input
                    id="scratch-testset-name"
                    autoFocus
                    value={name}
                    placeholder="Enter a name"
                    onChange={(event) => setName(event.target.value)}
                />
            </div>
            <DialogFooter>
                <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button type="submit" disabled={!trimmed}>
                    Create test set
                </Button>
            </DialogFooter>
        </form>
    )
}
