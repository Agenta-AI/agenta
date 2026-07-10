import {useState} from "react"

import {Check, Copy, Robot} from "@phosphor-icons/react"
import {Input} from "antd"
import dayjs from "dayjs"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

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

const FieldLabel = ({children}: {children: React.ReactNode}) => (
    <div className="mb-1.5 text-[11px] font-semibold capitalize text-colorTextTertiary">
        {children}
    </div>
)

const CopyButton = ({value, label}: {value: string; label: string}) => {
    const [copied, setCopied] = useState(false)
    const onCopy = () => {
        copyToClipboard(value, false)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onCopy}
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md border border-solid border-colorBorder bg-colorBgContainer text-colorTextSecondary transition-colors hover:border-colorBorderSecondary hover:text-colorText"
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
    )
}

/**
 * The agent's identity card — name and description edit inline (auto-save on blur/Enter, no OK
 * button), the slug is shown read-only because it does NOT change on rename, and type/version/
 * created sit alongside as context. Replaces the single-input rename modal on the playground.
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
        <div className="flex flex-col gap-3.5">
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

            {slug && (
                <div>
                    <FieldLabel>Slug</FieldLabel>
                    <div className="flex items-center gap-2">
                        <Input value={slug} disabled className="!text-xs !font-mono" />
                        <CopyButton value={slug} label="Copy slug" />
                    </div>
                    <div className="mt-1 text-[11px] text-colorTextTertiary">
                        slug stays fixed on rename
                    </div>
                </div>
            )}

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

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-colorTextSecondary">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-colorFillTertiary px-2 py-0.5 font-medium text-[var(--ag-c-13C2C2)]">
                    <Robot size={12} weight="fill" />
                    Agent
                </span>
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
            </div>

            <div className="flex items-center gap-2 border-0 border-t border-solid border-colorBorderSecondary pt-3">
                <span className="font-mono text-[11px] text-colorTextTertiary">
                    ID {workflowId.slice(0, 8)}…
                </span>
                <CopyButton value={workflowId} label="Copy ID" />
                <span className="flex-1" />
                {showSaved && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--ag-c-13C2C2)]">
                        <Check size={12} />
                        Saved
                    </span>
                )}
            </div>
        </div>
    )
}

export default AgentIdentityCard
