import React, {useCallback} from "react"

import {CopyButton, EnhancedModal, ModalContent} from "@agenta/ui"
import {Typography} from "antd"
import {useAtom} from "jotai"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {createdWebhookSecretAtom} from "@/oss/state/automations/state"

const SecretRevealModal: React.FC = () => {
    const [createdWebhookSecret, setCreatedWebhookSecret] = useAtom(createdWebhookSecretAtom)

    const handleCopySecret = useCallback(async () => {
        if (!createdWebhookSecret) return
        await copyToClipboard(createdWebhookSecret)
        setCreatedWebhookSecret(null)
    }, [createdWebhookSecret])

    return (
        <EnhancedModal
            title="Save Your Webhook Secret"
            open={!!createdWebhookSecret}
            onCancel={() => setCreatedWebhookSecret(null)}
            onOk={handleCopySecret}
            okText="Copy and close"
            cancelText="Close"
        >
            <ModalContent className="my-3 flex flex-col gap-3">
                <Typography.Text>
                    Please save this secret key in a secure location.
                    You will need it to verify that incoming webhook requests are from Agenta.
                </Typography.Text>

                <div className="flex items-center justify-between overflow-hidden rounded-md border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 dark:border-slate-700">
                    <span className="truncate">{createdWebhookSecret}</span>
                    <CopyButton
                        text={createdWebhookSecret || ""}
                        buttonText="Copy"
                        icon
                        type="text"
                    />
                </div>
            </ModalContent>
        </EnhancedModal>
    )
}

export default SecretRevealModal
