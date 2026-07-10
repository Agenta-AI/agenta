import {type ReactNode, useEffect, useState} from "react"

import {workflowAppTypeAtomFamily, workflowArtifactQueryAtomFamily} from "@agenta/entities/workflow"
import {Check, Copy} from "@phosphor-icons/react"
import {Input, Modal, Typography} from "antd"
import dayjs from "dayjs"
import {useAtomValue, useSetAtom} from "jotai"

import {useRenameApp} from "@/oss/components/EntityIdentity/useRenameApp"
import {getAppTypeIcon} from "@/oss/components/pages/prompts/assets/iconHelpers"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"

import {closeEditAppModalAtom, editAppModalAtom} from "./store/editAppModalStore"

const APP_TYPE_LABEL: Record<string, string> = {
    agent: "Agent",
    chat: "Chat",
    completion: "Completion",
    custom: "Custom workflow",
}

const FieldLabel = ({children}: {children: ReactNode}) => (
    <div className="mb-1.5 text-[12px] font-semibold text-colorTextSecondary">{children}</div>
)

/** Read-only value shown in a filled row with a copy-to-clipboard affordance. */
const CopyRow = ({value, label}: {value: string; label: string}) => {
    const [copied, setCopied] = useState(false)
    const onCopy = () => {
        copyToClipboard(value, false)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
    }
    return (
        <div className="flex items-center gap-2 rounded-lg border border-solid border-colorBorder bg-colorFillQuaternary px-2.5 py-1.5">
            <span className="flex-1 truncate font-mono text-[11.5px] text-colorTextSecondary">
                {value}
            </span>
            <button
                type="button"
                aria-label={label}
                onClick={onCopy}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-solid border-colorBorder bg-colorBgContainer text-colorTextSecondary transition-colors hover:border-colorBorderSecondary hover:text-colorText"
            >
                {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
        </div>
    )
}

/**
 * Rename + details modal opened from the home table row menu and the app-overview 3-dot
 * menu. Leads with the editable name (and description), then surfaces the read-only
 * context — type, version, created, slug (fixed on rename), workflow id — that a user
 * would otherwise dig for. The artifact fields are read reactively by id, so the modal
 * renders the same regardless of which surface opened it.
 */
const EditAppModal = () => {
    const {open, appDetails, onRenamed} = useAtomValue(editAppModalAtom)
    const closeModal = useSetAtom(closeEditAppModalAtom)
    const {renameApp, isDuplicateName} = useRenameApp()

    const workflowId = appDetails?.id ?? ""
    const artifact = useAtomValue(workflowArtifactQueryAtomFamily(workflowId))
    const appType = useAtomValue(workflowAppTypeAtomFamily(workflowId))
    const wf = artifact.data

    const [name, setName] = useState(appDetails?.name ?? "")
    const [description, setDescription] = useState("")
    const [descHydrated, setDescHydrated] = useState(false)
    const [nameError, setNameError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    // Reset on every open (a new appDetails object) or on close.
    useEffect(() => {
        setName(appDetails?.name ?? "")
        setDescription("")
        setDescHydrated(false)
        setNameError(null)
    }, [appDetails])

    // Seed the description once the artifact resolves.
    useEffect(() => {
        if (!descHydrated && wf) {
            setDescription(wf.description ?? "")
            setDescHydrated(true)
        }
    }, [wf, descHydrated])

    const typeLabel = APP_TYPE_LABEL[(appType ?? "").toLowerCase()] ?? "Application"

    const handleSave = async () => {
        const nextName = name.trim()
        if (!nextName) {
            setNameError("Name can't be empty")
            return
        }
        if (isDuplicateName(nextName, workflowId)) {
            setNameError("An app with this name already exists")
            return
        }
        setSaving(true)
        const ok = await renameApp({
            id: workflowId,
            name: nextName,
            description: description.trim(),
        })
        setSaving(false)
        if (!ok) return
        try {
            await onRenamed?.({id: workflowId, name: nextName})
        } catch (callbackError) {
            console.error(callbackError)
        }
        closeModal()
    }

    return (
        <Modal
            centered
            destroyOnHidden
            width={468}
            open={open}
            onCancel={closeModal}
            okText="Save changes"
            cancelText="Cancel"
            okButtonProps={{disabled: !name.trim() || !!nameError, loading: saving}}
            onOk={handleSave}
            title={
                <div className="flex items-center gap-3 pr-8">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-colorFillTertiary">
                        {getAppTypeIcon(appType ?? undefined)}
                    </div>
                    <div className="min-w-0 flex-1">
                        <Typography.Text className="block truncate text-sm font-semibold leading-tight">
                            {name || appDetails?.name || "Untitled"}
                        </Typography.Text>
                        <Typography.Text className="block text-xs font-normal text-colorTextTertiary">
                            Edit name, description &amp; view details
                        </Typography.Text>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-colorFillTertiary px-2 py-0.5 text-[11px] font-medium text-[var(--ag-c-13C2C2)]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--ag-c-13C2C2)]" />
                        {typeLabel}
                    </span>
                </div>
            }
        >
            <div className="mt-3 mb-1 flex flex-col gap-4">
                <div>
                    <FieldLabel>Name</FieldLabel>
                    <Input
                        value={name}
                        status={nameError ? "error" : undefined}
                        onChange={(e) => {
                            setName(e.target.value)
                            if (nameError) setNameError(null)
                        }}
                        onPressEnter={handleSave}
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
                        placeholder="Add a short description…"
                        autoSize={{minRows: 2, maxRows: 5}}
                        className="!text-[13px]"
                    />
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-0 border-t border-solid border-colorBorderSecondary pt-3.5">
                    {wf?.version != null && (
                        <div>
                            <FieldLabel>Version</FieldLabel>
                            <div className="text-[13px] text-colorText">v{wf.version}</div>
                        </div>
                    )}
                    {wf?.created_at && (
                        <div>
                            <FieldLabel>Created</FieldLabel>
                            <div className="text-[13px] text-colorText">
                                {dayjs(wf.created_at).format("MMM D, YYYY")}
                            </div>
                        </div>
                    )}
                    {wf?.slug && (
                        <div className="col-span-2">
                            <FieldLabel>
                                Slug{" "}
                                <span className="font-normal text-colorTextTertiary">
                                    · fixed on rename
                                </span>
                            </FieldLabel>
                            <CopyRow value={wf.slug} label="Copy slug" />
                        </div>
                    )}
                    {workflowId && (
                        <div className="col-span-2">
                            <FieldLabel>Workflow ID</FieldLabel>
                            <CopyRow value={workflowId} label="Copy workflow ID" />
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    )
}

export default EditAppModal
