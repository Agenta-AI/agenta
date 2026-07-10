import {useState} from "react"

import {Check} from "@phosphor-icons/react"
import {Input} from "antd"
import dayjs from "dayjs"

import {CopyRow, FieldLabel, TypeBadge} from "./fields"
import {useRenameApp} from "./useRenameApp"

interface AgentIdentityCardProps {
    /** Workflow (artifact) id — the rename target. */
    workflowId: string
    initialName: string
    initialDescription?: string | null
    slug?: string | null
    version?: number | null
    createdAt?: string | number | null
    /** Reflect a committed name back to the trigger (header keeps showing the live name). */
    onRenamed?: (name: string) => void
}

/**
 * The agent's identity card shown in the playground header popover. Mirrors the rename modal's
 * layout (name → description → details → slug/id) so the two rename surfaces read the same; the
 * difference is behavior — here name/description auto-save on blur (no OK button), with a brief
 * "Saved" flash. The slug is read-only because it does NOT change on rename.
 */
const AgentIdentityCard = ({
    workflowId,
    initialName,
    initialDescription,
    slug,
    version,
    createdAt,
    onRenamed,
}: AgentIdentityCardProps) => {
    const {renameApp, isDuplicateName} = useRenameApp()

    const [name, setName] = useState(initialName)
    const [description, setDescription] = useState(initialDescription ?? "")
    const [nameError, setNameError] = useState<string | null>(null)
    const [savedName, setSavedName] = useState(initialName)
    const [savedDescription, setSavedDescription] = useState(initialDescription ?? "")
    const [showSaved, setShowSaved] = useState(false)

    const flashSaved = () => {
        setShowSaved(true)
        setTimeout(() => setShowSaved(false), 1600)
    }

    const commitName = async () => {
        const next = name.trim()
        if (!next) {
            setName(savedName)
            setNameError(null)
            return
        }
        if (next === savedName) return
        if (isDuplicateName(next, workflowId)) {
            setNameError("An agent with this name already exists")
            return
        }
        setNameError(null)
        const ok = await renameApp({id: workflowId, name: next})
        if (ok) {
            setSavedName(next)
            onRenamed?.(next)
            flashSaved()
        }
    }

    const commitDescription = async () => {
        const next = description.trim()
        if (next === savedDescription.trim()) return
        const ok = await renameApp({id: workflowId, description: next})
        if (ok) {
            setSavedDescription(next)
            flashSaved()
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div>
                <FieldLabel>Name</FieldLabel>
                <Input
                    value={name}
                    status={nameError ? "error" : undefined}
                    onChange={(e) => {
                        setName(e.target.value)
                        if (nameError) setNameError(null)
                    }}
                    onPressEnter={(e) => e.currentTarget.blur()}
                    onBlur={commitName}
                    onFocus={(e) => e.target.select()}
                    className="!text-xs"
                />
                {nameError && <div className="mt-1 text-xs text-colorError">{nameError}</div>}
            </div>

            <div>
                <FieldLabel>Description</FieldLabel>
                <Input.TextArea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onBlur={commitDescription}
                    placeholder="Add a short description…"
                    autoSize={{minRows: 2, maxRows: 5}}
                    className="!text-[13px]"
                />
            </div>

            <div className="flex flex-col gap-3 border-0 border-t border-solid border-colorBorderSecondary pt-3.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-colorTextSecondary">
                    <TypeBadge label="Agent" />
                    {version != null && (
                        <>
                            <span className="text-colorTextTertiary">·</span>
                            <span>v{version}</span>
                        </>
                    )}
                    {createdAt && (
                        <>
                            <span className="text-colorTextTertiary">·</span>
                            <span>created {dayjs(createdAt).format("MMM D, YYYY")}</span>
                        </>
                    )}
                    <span className="flex-1" />
                    {showSaved && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ag-c-13C2C2)]">
                            <Check size={12} />
                            Saved
                        </span>
                    )}
                </div>
                {slug && (
                    <div>
                        <FieldLabel>
                            Slug{" "}
                            <span className="font-normal text-colorTextTertiary">
                                · fixed on rename
                            </span>
                        </FieldLabel>
                        <CopyRow value={slug} label="Copy slug" />
                    </div>
                )}
                <div>
                    <FieldLabel>Workflow ID</FieldLabel>
                    <CopyRow value={workflowId} label="Copy workflow ID" />
                </div>
            </div>
        </div>
    )
}

export default AgentIdentityCard
