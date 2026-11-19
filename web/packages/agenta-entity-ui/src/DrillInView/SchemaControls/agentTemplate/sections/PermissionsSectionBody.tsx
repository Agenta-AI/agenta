/**
 * The Permissions section's body: the agent-wide permission policy select
 * (`runner.permissions.default`). `useModelHarness` owns the runner state and passes it in.
 */
import type {ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"

import {PermissionPolicySelect, type PermissionPolicySelectProps} from "../PermissionPolicySelect"

import type {ModelHarnessT} from "./types"

export interface PermissionsSectionBodyParams {
    t: ModelHarnessT
    runnerPermissionSchema: SchemaProperty | undefined
    policyInFocus: boolean
    currentRunnerPermission: string
    setSection: (key: string, sectionValue: unknown) => void
    runner: Record<string, unknown>
    runnerPermissions: Record<string, unknown>
    runnerPermissionOptions: PermissionPolicySelectProps["options"]
    disabled?: boolean
}

export const permissionsSectionBody = ({
    t,
    runnerPermissionSchema,
    policyInFocus,
    currentRunnerPermission,
    setSection,
    runner,
    runnerPermissions,
    runnerPermissionOptions,
    disabled,
}: PermissionsSectionBodyParams): ReactNode => (
    <>
        {/* No rail label: the section header already reads "Policy: …", so the select
            takes the full width. */}
        {runnerPermissionSchema && policyInFocus ? (
            <PermissionPolicySelect
                value={currentRunnerPermission}
                onChange={(v) =>
                    setSection("runner", {
                        ...runner,
                        permissions: {...runnerPermissions, default: v},
                    })
                }
                options={runnerPermissionOptions}
                disabled={disabled}
                aria-label={t("entityUi.modelHarness.policy")}
            />
        ) : null}
    </>
)
