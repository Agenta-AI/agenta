/**
 * EntityCommitFooter Component
 *
 * Modal footer with cancel and commit buttons. When `deployOptions` are provided, the
 * commit button becomes a split button: the main action commits, and the caret opens a
 * small form to commit and then deploy to one or more environments with an optional
 * deployment message.
 */

import {useCallback, useState} from "react"

import {ModalFooter} from "@agenta/ui/components/modal"
import {cn, textColors} from "@agenta/ui/styles"
import {
    Button,
    Checkbox,
    LoadingButton,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Textarea,
} from "@agenta/ui/ui"
import {CaretUp} from "@phosphor-icons/react"

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
            className="w-[300px] rounded-lg border border-solid border-[var(--ag-colorBorder)] bg-[var(--ag-colorBgElevated)] p-3"
            style={{boxShadow: "0 10px 32px rgba(0, 0, 0, 0.55)"}}
        >
            <div className={cn("mb-2 text-xs font-medium", textColors.secondary)}>Deploy to</div>
            <div className="flex flex-col gap-2">
                {options.map((o) => (
                    <label
                        key={o.key}
                        className={cn(
                            "flex items-center gap-2 text-xs",
                            o.disabled ? "cursor-not-allowed text-disabled" : "cursor-pointer",
                        )}
                    >
                        <Checkbox
                            checked={envs.includes(o.key)}
                            disabled={o.disabled}
                            onCheckedChange={(next) =>
                                setEnvs((prev) =>
                                    next === true
                                        ? [...prev, o.key]
                                        : prev.filter((k) => k !== o.key),
                                )
                            }
                        />
                        {o.hint ? (
                            <span className="flex items-center gap-2">
                                {o.label}
                                <span className={cn("text-xs", textColors.tertiary)}>{o.hint}</span>
                            </span>
                        ) : (
                            o.label
                        )}
                    </label>
                ))}
            </div>
            <div className={cn("mb-1.5 mt-4 text-xs font-medium", textColors.secondary)}>
                Deployment message <span className={textColors.tertiary}>(optional)</span>
            </div>
            <Textarea
                value={deployMessage}
                onChange={(e) => setDeployMessage(e.target.value)}
                rows={2}
                placeholder="Describe this deployment…"
            />
            <LoadingButton
                className="mt-3 w-full"
                loading={isLoading}
                disabled={!canProceed || envs.length === 0}
                onClick={() => onDeploy(envs, deployMessage.trim() || undefined)}
            >
                {confirmLabel} &amp; deploy
            </LoadingButton>
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
                <Button variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                {/* Split button (was antd Space.Compact): flex + -ml-px + rounded joins. */}
                <div className="flex">
                    <LoadingButton
                        className="rounded-r-none"
                        loading={isLoading}
                        disabled={!canProceed}
                        onClick={handleCommit}
                    >
                        {confirmLabel}
                    </LoadingButton>
                    <Popover open={deployOpen} onOpenChange={setDeployOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                size="icon"
                                className="-ml-px rounded-l-none"
                                disabled={!canProceed}
                                aria-label="Commit and deploy options"
                            >
                                <CaretUp size={12} />
                            </Button>
                        </PopoverTrigger>
                        {/* The DeployForm carries its own panel chrome; neutralize the default. */}
                        <PopoverContent
                            side="top"
                            align="end"
                            className="w-auto bg-transparent p-0 shadow-none"
                        >
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
                        </PopoverContent>
                    </Popover>
                </div>
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
