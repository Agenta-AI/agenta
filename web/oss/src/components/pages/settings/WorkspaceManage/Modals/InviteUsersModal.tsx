import {useCallback, useMemo, useState, type FC} from "react"

import {Alert, AlertDescription} from "@agenta/primitive-ui/components/alert"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Form, FormField, FormList, useAppForm} from "@agenta/primitive-ui/components/form"
import {Input} from "@agenta/primitive-ui/components/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {MinusCircle} from "@phosphor-icons/react"
import Link from "next/link"
import {z} from "zod"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {isEE, isEmailInvitationsEnabled} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {snakeToTitle} from "@/oss/lib/helpers/utils"
import {inviteToWorkspace} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useWorkspaceRoles} from "@/oss/state/workspace"

import {InviteUsersModalProps} from "./assets/types"

const inviteSchema = z.object({
    emails: z.array(z.object({value: z.email("Please enter a valid email")})).min(1),
    role: z.string().nullable(),
})

type InviteFormValues = z.input<typeof inviteSchema>

const InviteUsersModal: FC<InviteUsersModalProps> = ({
    onSuccess,
    workspaceId,
    setQueryInviteModalOpen,
    open,
    onClose,
}) => {
    const [loading, setLoading] = useState(false)
    const {selectedOrg, refetch} = useOrgData()
    const {roles} = useWorkspaceRoles()
    const {hasRBAC} = useEntitlements()
    const organizationId = selectedOrg?.id
    const canSelectRole = !isEE() || hasRBAC
    const form = useAppForm({
        schema: inviteSchema,
        defaultValues: {
            emails: [{value: ""}],
            role: canSelectRole ? "viewer" : null,
        },
    })

    const filteredRoles = useMemo(() => roles.filter((role) => role.role_name !== "owner"), [roles])

    useLazyEffect(() => {
        if (open) {
            form.reset({emails: [{value: ""}], role: canSelectRole ? "viewer" : null})
        }
    }, [open])

    const handleClose = useCallback(() => {
        onClose()
        setQueryInviteModalOpen("")
    }, [onClose, setQueryInviteModalOpen])

    const handleSubmit = useCallback(
        ({emails, role}: InviteFormValues) => {
            if (!organizationId) return

            setLoading(true)
            inviteToWorkspace(
                {
                    data: emails.map(({value}) => ({
                        email: value,
                        ...(role ? {roles: [role]} : {}),
                    })),
                    organizationId,
                    workspaceId,
                },
                true,
            )
                .then((responses) => {
                    if (!isEmailInvitationsEnabled() && typeof responses.url === "string") {
                        onSuccess?.({email: emails[0].value, uri: responses.url})
                    } else {
                        toast.success("Invitations sent!")
                        onSuccess?.(null)
                        refetch()
                    }

                    form.reset()
                    handleClose()
                })
                .catch((error: any) => {
                    const detail = error?.response?.data?.detail
                    const rawError =
                        typeof error?.response?.data?.error === "string"
                            ? error.response.data.error
                            : undefined
                    const detailMessage =
                        typeof detail === "string"
                            ? detail
                            : detail?.message || rawError || "Failed to send invitations"
                    const isDomainRestricted =
                        typeof detailMessage === "string" &&
                        detailMessage.toLowerCase().includes("domain")
                    toast.error(
                        isDomainRestricted
                            ? "Only verified domains are allowed in this organization."
                            : detailMessage,
                    )
                })
                .finally(() => setLoading(false))
        },
        [form, handleClose, onSuccess, organizationId, refetch, workspaceId],
    )

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) handleClose()
            }}
        >
            <DialogContent className="sm:max-w-[450px]">
                <DialogHeader>
                    <DialogTitle>Invite Members</DialogTitle>
                    <DialogDescription>
                        Invite members to your team by entering their emails.{" "}
                        {isEE() && !hasRBAC
                            ? "Role-based access control is available on Business and Enterprise plans."
                            : "You can specify the roles to control the access level of the invited members on Agenta."}
                    </DialogDescription>
                </DialogHeader>

                <Form id="invite-members-form" form={form} onSubmit={handleSubmit}>
                    <FormList<InviteFormValues, "emails"> name="emails">
                        {(fields, {remove}) => (
                            <div className="flex flex-col gap-3">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="flex items-start gap-2">
                                        <FormField
                                            name={`emails.${index}.value`}
                                            className="flex-1"
                                        >
                                            {(inputField) => (
                                                <Input
                                                    {...inputField}
                                                    type="email"
                                                    placeholder="member@organization.com"
                                                />
                                            )}
                                        </FormField>
                                        {fields.length > 1 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Remove email"
                                                onClick={() => remove(index)}
                                            >
                                                <MinusCircle />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </FormList>

                    {canSelectRole ? (
                        <FormField name="role" required>
                            {(field) => (
                                <Select
                                    value={field.value ?? undefined}
                                    onValueChange={field.onChange}
                                >
                                    <SelectTrigger className="w-full" aria-label="Role">
                                        <SelectValue placeholder="Select role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {filteredRoles.map((role) => (
                                            <SelectItem key={role.role_name} value={role.role_name}>
                                                <span className="flex flex-col">
                                                    <span>
                                                        {snakeToTitle(role.role_name || "")}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {role.role_description}
                                                    </span>
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </FormField>
                    ) : (
                        <Alert>
                            <AlertDescription className="flex flex-col">
                                <span>
                                    Role selection is only available for Business and Enterprise
                                    plans.
                                </span>
                                <Link
                                    href="https://agenta.ai/pricing"
                                    target="_blank"
                                    className="font-medium"
                                >
                                    Click here to learn more
                                </Link>
                            </AlertDescription>
                        </Alert>
                    )}
                </Form>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={loading}>
                        Cancel
                    </Button>
                    <Button type="submit" form="invite-members-form" disabled={loading}>
                        {loading ? <Spinner /> : null}
                        Invite
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default InviteUsersModal
