import {useCallback, useState, useMemo, type FC} from "react"

import {MinusCircleOutlined} from "@ant-design/icons"
import {Form, Input, Modal, Select, Space, Typography, message, theme} from "antd"
import {useAtom} from "jotai"

import {useOrgData} from "@/oss/contexts/org.context"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {workspaceRolesAtom} from "@/oss/lib/atoms/organization"
import {isDemo, snakeToTitle} from "@/oss/lib/helpers/utils"
import {inviteToWorkspace} from "@/oss/services/workspace/api"

import {InviteFormProps, InviteUsersModalProps} from "./assets/types"

const InviteForm: FC<InviteFormProps> = ({onSuccess, workspaceId, form, setLoading}) => {
    const {selectedOrg, refetch} = useOrgData()
    const [roles] = useAtom(workspaceRolesAtom)
    const {token} = theme.useToken()
    const orgId = selectedOrg?.id

    const filteredRoles = useMemo(() => {
        if (!isDemo()) {
            return roles.filter((role) => role.role_name !== "owner")
        }
        return roles
    }, [roles])

    const onSubmit = useCallback(
        ({emails, role}: {emails: string[]; role: string | null}) => {
            if (!orgId) return

            setLoading(true)

            inviteToWorkspace({
                data: emails.map((email) => ({
                    email,
                    ...(role ? {roles: [role]} : {}),
                })),
                orgId,
                workspaceId,
            })
                .then((responses) => {
                    if (!isDemo() && typeof responses.url === "string") {
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
                .catch(console.error)
                .finally(() => setLoading(false))
        },
        [orgId],
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
            {isDemo() ? (
                <Form.Item
                    name="role"
                    rules={[{required: true, message: "Please select a role"}]}
                    initialValue="editor"
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
                        optionRender={(option) => (
                            <Space direction="vertical" size="small">
                                <Typography.Text>{option.label}</Typography.Text>
                                <Typography.Text className="text-wrap" type="secondary">
                                    {option.data.desc}
                                </Typography.Text>
                            </Space>
                        )}
                        optionLabelProp="label"
                    />
                </Form.Item>
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
            width={400}
            onCancel={onCancel}
            destroyOnClose
        >
            <Typography.Paragraph type="secondary">
                Invite members to your team by entering their emails.{" "}
                {!isDemo()
                    ? "Role base access control is available in the cloud and enterprise editions of Agenta"
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
