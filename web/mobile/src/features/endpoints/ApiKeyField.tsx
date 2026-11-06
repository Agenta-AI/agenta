import {useState} from "react"

import {createApiKey} from "@agenta/settings"
import {message} from "@agenta/ui/app-message"
import {Button, Input} from "@agenta/ui/ui"

import {useProjectPermission} from "../context/useProjectPermission"

/**
 * "Create or enter your API key", as in the old app's Use API drawers. The key goes into the
 * snippets. Generating one needs the key permission, so a reader without it can only paste one.
 */
export const ApiKeyField = ({
    workspaceId,
    projectId,
    value,
    onChange,
}: {
    workspaceId: string
    projectId: string
    value: string
    onChange: (key: string) => void
}) => {
    const canCreate = useProjectPermission(projectId, "edit_api_keys")
    const [creating, setCreating] = useState(false)

    const generate = async () => {
        setCreating(true)
        try {
            const key = await createApiKey(workspaceId, projectId)
            if (!key) throw new Error("The server returned no key")
            onChange(key)
            message.success("Successfully generated API Key")
        } catch (error) {
            console.error("Generate API key failed", error)
            message.error("Unable to generate API Key")
        } finally {
            setCreating(false)
        }
    }

    return (
        <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Create or enter your API key
            <span className="flex items-center gap-2">
                <Input
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="Enter existing API key"
                    className="max-w-[300px]"
                    autoComplete="off"
                />
                {canCreate ? (
                    <Button
                        type="button"
                        size="sm"
                        disabled={creating}
                        onClick={() => void generate()}
                    >
                        {creating ? "Generating…" : "Generate API Key"}
                    </Button>
                ) : null}
            </span>
        </label>
    )
}
