import {useEffect, useState} from "react"

import {Button, DialogFooter, Input} from "@agenta/ui/ui"
import {Code, PencilSimple} from "@phosphor-icons/react"
import {Loader2} from "lucide-react"

import {TestsetFileDrop} from "./TestsetFileDrop"
import {useTestsetFilePick} from "./useTestsetFilePick"
import {useUploadTestset, type CreatedTestset} from "./useUploadTestset"

const fileBaseName = (fileName: string): string => fileName.replace(/\.[^./\\]+$/, "")

const ChoiceCard = ({
    icon,
    title,
    description,
    onClick,
}: {
    icon: React.ReactNode
    title: string
    description: string
    onClick: () => void
}) => (
    <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-lg border border-solid border-border bg-transparent p-3 text-left hover:bg-muted"
    >
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
    </button>
)

/**
 * The first step of the create dialog. Without a file it offers the file drop and the two other
 * ways to make a test set. With a file it asks for a name and uploads.
 */
export const UploadTestsetStep = ({
    projectId,
    base,
    onClose,
    onCreated,
    onPendingChange,
    onScratch,
    onApi,
}: {
    projectId: string
    base: string
    onClose: () => void
    /** Tells the dialog a save is running, so it stays open until the save ends. */
    onPendingChange: (pending: boolean) => void
    /** The host's next step after an upload, instead of opening the new test set page. */
    onCreated?: (created: CreatedTestset) => void
    /** Leave both out to hide the manual ways. */
    onScratch?: () => void
    onApi?: () => void
}) => {
    const picked = useTestsetFilePick()
    const [name, setName] = useState("")
    const {upload, pending, error, clearError} = useUploadTestset({
        projectId,
        base,
        onDone: onClose,
        onCreated,
    })

    useEffect(() => onPendingChange(pending), [onPendingChange, pending])

    const onFile = async (file: File) => {
        // An error belongs to the file that caused it.
        clearError()
        // Prefill only from an accepted file, and only an empty name, so a typed name stays.
        if (await picked.pick(file)) setName((current) => current || fileBaseName(file.name))
    }
    const onRemove = () => {
        picked.remove()
        clearError()
        setName("")
    }

    const {file} = picked
    return (
        <>
            <div className="flex min-w-0 flex-col gap-4">
                <TestsetFileDrop
                    file={file}
                    preview={picked.rows}
                    error={picked.error}
                    disabled={pending}
                    onFile={(chosen) => void onFile(chosen)}
                    onRemove={onRemove}
                />
                {file ? (
                    <form
                        id="upload-testset-form"
                        className="flex flex-col gap-1.5"
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (picked.fileType)
                                void upload({file, fileType: picked.fileType, name})
                        }}
                    >
                        <label htmlFor="upload-testset-name" className="text-sm font-medium">
                            Test set name
                        </label>
                        <Input
                            id="upload-testset-name"
                            value={name}
                            placeholder="Enter a name"
                            disabled={pending}
                            onChange={(event) => setName(event.target.value)}
                        />
                        {error ? (
                            <p role="alert" className="m-0 text-xs text-destructive">
                                {error}
                            </p>
                        ) : null}
                    </form>
                ) : onScratch && onApi ? (
                    <div className="flex flex-col gap-2">
                        <p className="m-0 text-sm text-muted-foreground">
                            Or create a test set manually
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <ChoiceCard
                                icon={<PencilSimple aria-hidden size={18} />}
                                title="New via UI"
                                description="Create from scratch"
                                onClick={onScratch}
                            />
                            <ChoiceCard
                                icon={<Code aria-hidden size={18} />}
                                title="Create via API"
                                description="Use API endpoints"
                                onClick={onApi}
                            />
                        </div>
                    </div>
                ) : null}
            </div>
            {file ? (
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="upload-testset-form"
                        disabled={pending || !name.trim()}
                    >
                        {pending ? <Loader2 aria-hidden className="animate-spin" /> : null}
                        Create test set
                    </Button>
                </DialogFooter>
            ) : null}
        </>
    )
}
