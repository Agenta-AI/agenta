import {useEffect, useRef, useState} from "react"

import type {ProjectMemberProfile} from "@agenta/entities/sharing"
import {useT} from "@agenta/i18n"
import sharingCatalog from "@agenta/i18n/catalogs/entityUi.sharing"
import {
    MemberPicker,
    personName,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
import {LoadingButton} from "@agenta/ui/composed"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

import {agentSharingCopy as copy} from "./copy"

export interface AgentTransferFormProps {
    isPrivate: boolean
    ownerUserId?: string | null
    members: readonly ProjectMemberProfile[]
    membersSearch: string
    onMembersSearch: (text: string) => void
    membersLoading?: boolean
    membersError?: boolean
    onTransfer: (userId: string) => Promise<SharingWriteResult>
    /** Called after a transfer landed, with the new owner. */
    onTransferred?: (owner: SharingPerson) => void
    /** Called with a result that is neither ok nor `invalid_grantee`. */
    onFailed?: (result: SharingWriteResult) => void
    /** Closes the step. */
    onCancel: () => void
}

/** The transfer step under the owner row: pick the new owner, then confirm in a dialog (ACT-03). */
export const AgentTransferForm = ({
    isPrivate,
    ownerUserId,
    members,
    membersSearch,
    onMembersSearch,
    membersLoading,
    membersError,
    onTransfer,
    onTransferred,
    onFailed,
    onCancel,
}: AgentTransferFormProps) => {
    // The texts come from `copy`; this draws the form again when the language's text loads.
    useT(sharingCatalog)
    const [target, setTarget] = useState<SharingPerson | null>(null)
    const [invalid, setInvalid] = useState(false)
    const [saving, setSaving] = useState(false)
    const [confirming, setConfirming] = useState(false)
    const name = personName(target)
    const rootRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        rootRef.current?.querySelector("input")?.focus()
    }, [])

    const transfer = async () => {
        if (!target) return
        setSaving(true)
        let result: SharingWriteResult
        try {
            result = await onTransfer(target.user_id)
        } catch {
            result = "failed"
        }
        setSaving(false)
        setConfirming(false)
        if (result === "ok") onTransferred?.(target)
        else if (result === "invalid_grantee") setInvalid(true)
        else onFailed?.(result)
    }

    return (
        <div ref={rootRef} className="ag-view-enter flex flex-col gap-2">
            <MemberPicker
                mode="single"
                members={members}
                search={membersSearch}
                onSearch={onMembersSearch}
                selected={target ? [target] : []}
                onPick={(member) => {
                    setTarget(member)
                    setInvalid(false)
                }}
                onRemove={() => {
                    setTarget(null)
                    setInvalid(false)
                }}
                excludeUserIds={ownerUserId ? [ownerUserId] : []}
                invalidUserIds={invalid && target ? [target.user_id] : []}
                loading={membersLoading}
                error={membersError}
                disabled={saving}
                placeholder={copy.transferPickerPlaceholder}
            />
            {invalid && target ? (
                <p className="m-0 text-meta text-destructive">{copy.transferInvalid(name)}</p>
            ) : null}
            {/* The step's own row: Cancel beside its action, so the owner row keeps its place. */}
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
                    {copy.cancel}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={!target || invalid || saving}
                    onClick={() => setConfirming(true)}
                >
                    {copy.transferShort}
                </Button>
            </div>
            <AlertDialog
                open={confirming && Boolean(target)}
                onOpenChange={(next) => !next && !saving && setConfirming(false)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{copy.transferTo(name)}</AlertDialogTitle>
                        {/* One description, so the dialog announces both warnings of a private agent. */}
                        <AlertDialogDescription asChild>
                            <div className="flex flex-col gap-2">
                                <p className="m-0">
                                    {isPrivate
                                        ? copy.transferPrivateWarning(name)
                                        : copy.transferShared(name)}
                                </p>
                                {isPrivate ? (
                                    <p className="m-0">{copy.transferPrivateChats}</p>
                                ) : null}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saving}>{copy.cancel}</AlertDialogCancel>
                        <LoadingButton
                            variant={isPrivate ? "destructive" : "default"}
                            loading={saving}
                            onClick={() => void transfer()}
                        >
                            {copy.transferShort}
                        </LoadingButton>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
