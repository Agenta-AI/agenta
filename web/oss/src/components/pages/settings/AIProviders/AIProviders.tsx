import {AIProvidersPage} from "@agenta/settings-ui"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {Trash} from "@phosphor-icons/react"
import {Typography} from "antd"

/**
 * Settings → AI providers, desktop binding.
 *
 * The page itself is shared with `/m` (`@agenta/settings-ui`); this file supplies only the
 * removal chrome, which is the modal every other desktop settings table confirms in.
 */
const AIProviders = () => (
    <AIProvidersPage
        renderRemoveDialog={({connection, open, pending, onConfirm, onClose}) => (
            <EnhancedModal
                title="Are you sure you want to delete?"
                open={open}
                okText="Delete"
                okType="danger"
                okButtonProps={{icon: <Trash size={14} className="mt-0.5" />, type: "primary"}}
                classNames={{footer: "flex items-center justify-end"}}
                confirmLoading={pending}
                onOk={onConfirm}
                onCancel={onClose}
            >
                <div className="flex flex-col gap-4">
                    <Typography.Text>
                        This action is not reversible. Agents and prompts using this connection stop
                        working.
                    </Typography.Text>

                    <div className="flex flex-col gap-1">
                        <Typography.Text>You are about to delete:</Typography.Text>
                        <Typography.Text className="text-sm font-medium">
                            {connection?.name}
                        </Typography.Text>
                    </div>
                </div>
            </EnhancedModal>
        )}
    />
)

export default AIProviders
