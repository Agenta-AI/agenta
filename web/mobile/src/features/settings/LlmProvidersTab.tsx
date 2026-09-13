import {AIProvidersPage} from "@agenta/settings-ui"

import {ConfirmModal} from "./ConfirmModal"

/**
 * Mobile binding: the same AI-providers page the desktop renders, with this app's bottom
 * modal as the removal confirmation.
 */
export const LlmProvidersTab = () => (
    <AIProvidersPage
        renderRemoveDialog={({connection, open, pending, error, onConfirm, onClose}) => (
            <ConfirmModal
                open={open}
                title="Are you sure you want to delete?"
                description="This action is not reversible. Agents and prompts using this connection stop working."
                body={
                    <div className="flex flex-col gap-1">
                        <span>You are about to delete:</span>
                        <span className="font-medium">{connection?.name}</span>
                    </div>
                }
                confirmLabel="Delete"
                pending={pending}
                error={error}
                onConfirm={onConfirm}
                onClose={onClose}
            />
        )}
    />
)
