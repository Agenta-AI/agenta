import {useCallback, useState, useMemo, type FC} from "react"

import {message} from "@agenta/ui/app-message"
import {MinusCircleOutlined} from "@ant-design/icons"
import {Alert, Form, Input, Modal, Select, Space, Typography, theme} from "antd"
import Link from "next/link"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {isEE, isEmailInvitationsEnabled} from "@/oss/lib/helpers/isEE"
import {useEntitlements} from "@/oss/lib/helpers/useEntitlements"
import {snakeToTitle} from "@/oss/lib/helpers/utils"
import {inviteToWorkspace} from "@/oss/services/workspace/api"
import {useOrgData} from "@/oss/state/org"
import {useWorkspaceRoles} from "@/oss/state/workspace"

import {InviteFormProps, InviteUsersModalProps} from "./assets/types"

const InviteForm: FC<InviteFormProps> = ({onSuccess, workspaceId, form, setLoading}) => {
    const {selectedOrg, refetch} = useOrgData()
    const {roles} = useWorkspaceRoles()
    const {hasRBAC} = useEntitlements()
    const {token} = theme.useToken()
    const organizationId = selectedOrg?.id

    const filteredRoles = useMemo(() => {
        // Always filter out "owner" role from invite dropdown
        return roles.filter((role) => role.role_name !== "owner")
    }, [roles])

    const onSubmit = useCallback(
        ({emails, role}: {emails: string[]; role: string | null}) => {
            if (!organizationId) return

            setLoading(true)

            inviteToWorkspace(
                {
                    data: emails.map((email) => ({
                        email,
                        ...(role ? {roles: [role]} : {}),
                    })),
                    organizationId,
                    workspaceId,
                },
                true,
            )
                .then((responses) => {
                    if (!isEmailInvitationsEnabled() && typeof responses.url === "string") {
                        onSuccess?.({
                            email: emails[0],
                            uri: responses.url,
                        })
                    } else {
                        message.success("Invitations sent!")
                        onSuccess?.(null)
                        refetch()
                    }

                    form.resetFields()
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
                    message.error(
                        isDomainRestricted
                            ? "Only verified domains are allowed in this organization."
                            : detailMessage,
                    )
                })
                .finally(() => setLoading(false))
        },
        [organizationId],
    )

    return (
        <Form form={form} onFinish={onSubmit}>
            <Form.List name="emails" initialValue={[""]}>
                {(fields, {add, remove}) => (
                    <>
                        {fields.map(({key, name, ...restField}) => (
                            <Space
                                key={key}
                                align="baseline"
                                className="w-full [&_>.ant-space-item:nth-child(1)]:flex-1 [&_.ant-form-item]:mb-3"
                            >
                                <Form.Item
                                    {...restField}
                                    name={name}
                                    rules={[
                                        {required: true, message: "Please enter email"},
                                        {type: "email", message: "Please enter a valid email"},
                                    ]}
                                >
                                    <Input type="email" placeholder="member@organization.com" />
                                </Form.Item>
                                {fields.length > 1 && (
                                    <MinusCircleOutlined
                                        className="text-xl"
                                        style={{color: token.colorTextSecondary}}
                                        onClick={() => remove(name)}
                                    />
                                )}
                            </Space>
                        ))}

                        {/* NOTE: The code disables the ability to invite multiple users at once due to the complexity of handling partial failures, entitlement limits, and lifecycle management. The marginal benefit of saving a few clicks does not justify the added complexity.
                         */}
                        {/* <Form.Item>
                            <Button
                                type="dashed"
                                onClick={() => add()}
                                block
                                icon={<PlusOutlined />}
                                disabled={!isDemo()}
                            >
                                Add another
                            </Button>
                        </Form.Item> */}
                    </>
                )}
            </Form.List>
            {isEE() && hasRBAC ? (
                <>
                    <Form.Item
                        name="role"
                        rules={[{required: true, message: "Please select a role"}]}
                        initialValue="editor"
                        className="mb-1"
                    >
                        <Select
                            allowClear
                            className="w-full"
                            placeholder="Select role"
                            options={filteredRoles.map((role) => ({
                                label: snakeToTitle(role.role_name || ""),
                                value: role.role_name,
                                desc: role.role_description,
                            }))}
                            disabled={!hasRBAC}
                            optionRender={(option) => (
                                <Space orientation="vertical" size="small">
                                    <Typography.Text>{option.label}</Typography.Text>
                                    <Typography.Text className="text-wrap" type="secondary">
                                        {option.data.desc}
                                    </Typography.Text>
                                </Space>
                            )}
                            optionLabelProp="label"
                        />
                    </Form.Item>
                    {!hasRBAC ? (
                        <Alert
                            message={
                                <div className="flex flex-col">
                                    <Typography.Text>
                                        Role selection is only available for Business and Enterprise
                                        plans.
                                    </Typography.Text>

                                    <Link
                                        href={"https://agenta.ai/pricing"}
                                        target="_blank"
                                        className="font-medium"
                                    >
                                        Click here to learn more
                                    </Link>
                                </div>
                            }
                            type="warning"
                            showIcon
                        />
                    ) : null}
                </>
            ) : null}
        </Form>
    )
}

const InviteUsersModal: FC<InviteUsersModalProps> = ({
    onSuccess,
    workspaceId,
    setQueryInviteModalOpen,
    ...props
}) => {
    const [form] = Form.useForm()
    const [loading, setLoading] = useState(false)
    const {hasRBAC} = useEntitlements()

    useLazyEffect(() => {
        if (props.open) form.resetFields()
    }, [props.open])

    const onCancel = () => {
        props.onCancel?.({} as any)
        setQueryInviteModalOpen("")
    }

    return (
        <Modal
            {...props}
            title="Invite Members"
            onOk={form.submit}
            okText="Invite"
            okButtonProps={{loading}}
            width={450}
            onCancel={onCancel}
            destroyOnHidden
        >
            <Typography.Paragraph type="secondary">
                Invite members to your team by entering their emails.{" "}
                {!isEE() || !hasRBAC
                    ? "Role-based access control is available in Cloud/EE."
                    : "You can specify the roles to control the access level of the invited members on Agenta."}
            </Typography.Paragraph>
            <InviteForm
                form={form}
                onSuccess={(data) => {
                    onSuccess?.(data)
                    props.onCancel?.(undefined as any)
                }}
                workspaceId={workspaceId}
                setLoading={setLoading}
            />
        </Modal>
    )
}

export default InviteUsersModal
