import {TestsetFileDrop} from "../testsets/create/TestsetFileDrop"

/**
 * "Create a new test set" in the playground's load dialog, as in the old playground: a CSV or JSON
 * file dropped (or picked) here opens the create dialog with that file, ready to name and upload.
 */
export const PlaygroundTestsetDrop = ({onFile}: {onFile: (file: File) => void}) => (
    <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Create a new test set</span>
        <TestsetFileDrop
            file={null}
            preview={[]}
            totalRows={0}
            error={null}
            onFile={onFile}
            onRemove={() => undefined}
        />
    </div>
)
