/**
 * EntityCommitFooter Component
 *
 * Modal footer with cancel and commit buttons. When `deployOptions` are provided, the
 * commit button becomes a split button: the main action commits, and the caret opens a
 * small form to commit and then deploy to one or more environments with an optional
 * deployment message.
 */

import {useCallback, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {ModalFooter} from "@agenta/ui/components/modal"
import {cn, textColors} from "@agenta/ui/styles"
import {CaretUp} from "@phosphor-icons/react"
import {Checkbox, Dropdown, Input, Space} from "antd"

import type {CommitDeployOption} from "../../types"

interface EntityCommitFooterProps {
    /** Callback when modal is closed/cancelled */
    onClose: () => void
    /** Callback when commit is confirmed; optional environments + message deploy after commit */
    onConfirm: (deployEnvironments?: string[], deployMessage?: string) => Promise<void> | void
    /** Loading state */
    isLoading: boolean
    /** Whether commit can proceed */
    canProceed: boolean
    /** Confirm button label */
    confirmLabel?: string
    /** When set, the commit button becomes a "commit & deploy" split button. */
    deployOptions?: CommitDeployOption[]
}

function DeployForm({
    options,
    confirmLabel,
    isLoading,
    canProceed,
    onDeploy,
}: {
    options: CommitDeployOption[]
    confirmLabel: string
    isLoading: boolean
    canProceed: boolean
    onDeploy: (envs: string[], message?: string) => void
}) {
    const [envs, setEnvs] = useState<string[]>([])
    const [deployMessage, setDeployMessage] = useState("")

    return (
        <div
            className="w-[300px] rounded-lg border border-[var(--ag-colorBorder)] bg-[var(--ag-colorBgElevated)] p-3"
            style={{boxShadow: "0 10px 32px rgba(0, 0, 0, 0.55)"}}
        >
            <div className={cn("mb-2 text-xs font-medium", textColors.secondary)}>Deploy to</div>
            <Checkbox.Group
                className="flex flex-col gap-2"
                value={envs}
                onChange={(v) => setEnvs(v as string[])}
                options={options.map((o) => ({
                    label: o.hint ? (
                        <span className="flex items-center gap-2">
                            {o.label}
                            <span className={cn("text-[11px]", textColors.tertiary)}>{o.hint}</span>
                        </span>
                    ) : (
                        o.label
                    ),
                    value: o.key,
                    disabled: o.disabled,
                }))}
            />
            <div className={cn("mb-1.5 mt-4 text-xs font-medium", textColors.secondary)}>
                Deployment message <span className={textColors.tertiary}>(optional)</span>
            </div>
            <Input.TextArea
                value={deployMessage}
                onChange={(e) => setDeployMessage(e.target.value)}
                rows={2}
                placeholder="Describe this deployment…"
            />
            <Button
                className="mt-3 w-full"
                disabled={!canProceed || envs.length === 0 || isLoading}
                onClick={() => onDeploy(envs, deployMessage.trim() || undefined)}
            >
                {isLoading ? <Spinner /> : null}
                {confirmLabel} &amp; deploy
            </Button>
        </div>
    )
}

export function EntityCommitFooter({
    onClose,
    onConfirm,
    isLoading,
    canProceed,
    confirmLabel = "Commit",
    deployOptions,
}: EntityCommitFooterProps) {
    const [deployOpen, setDeployOpen] = useState(false)

    const handleCommit = useCallback(async () => {
        await onConfirm()
    }, [onConfirm])

    if (deployOptions && deployOptions.length > 0) {
        return (
            <div className="flex items-center justify-end gap-2">
                <Button onClick={onClose} variant="outline">
                    Cancel
                </Button>
                <Space.Compact>
                    <Button disabled={!canProceed || isLoading} onClick={handleCommit}>
                        {isLoading ? <Spinner /> : null}
                        {confirmLabel}
                    </Button>
                    <Dropdown
                        open={deployOpen}
                        onOpenChange={setDeployOpen}
                        trigger={["click"]}
                        placement="topRight"
                        disabled={!canProceed}
                        dropdownRender={() => (
                            <DeployForm
                                options={deployOptions}
                                confirmLabel={confirmLabel}
                                isLoading={isLoading}
                                canProceed={canProceed}
                                onDeploy={(envs, message) => {
                                    setDeployOpen(false)
                                    onConfirm(envs, message)
                                }}
                            />
                        )}
                    >
                        <Button
                            disabled={!canProceed}
                            aria-label="Commit and deploy options"
                            size="icon"
                        >
                            {<CaretUp size={12} />}
                        </Button>
                    </Dropdown>
                </Space.Compact>
            </div>
        )
    }

    return (
        <ModalFooter
            onCancel={onClose}
            onConfirm={handleCommit}
            confirmLabel={confirmLabel}
            isLoading={isLoading}
            canConfirm={canProceed}
        />
    )
}
