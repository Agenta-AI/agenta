/**
 * ProviderCredentialsSection — the container for the "Provider credentials" pane.
 *
 * It owns the data reads: the project vault (`standardSecretsAtom` / `customSecretsAtom`) and, for
 * the self-managed card, the live runner subscription status. Everything that renders lives in
 * `ProviderCredentialsSectionView`, which takes them as plain props — the container/presentational
 * split that makes the pane storiable with plain data. Key WRITES stay inside `ProviderKeyField`
 * (immediate save, no drawer Save step; design.md §3.1).
 *
 * Design: docs/design/connect-model-drawer/design.md §3, §7, §8;
 * docs/design/runner-subscription-status/api-design.md ("Frontend display").
 */
import {useCallback, useMemo} from "react"

import {customSecretsAtom, standardSecretsAtom} from "@agenta/entities/secret"
import {
    resolveSubscriptionStatus,
    subscriptionStatusKey,
    subscriptionStatusQueryAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {
    ProviderCredentialsSectionView,
    type ProviderCredentialsSectionViewProps,
} from "./ProviderCredentialsSectionView"

export type ProviderCredentialsSectionProps = Omit<
    ProviderCredentialsSectionViewProps,
    "standardSecrets" | "customSecrets" | "subscriptionStatus" | "onCheckAgain"
> & {
    /** The selected harness (`config.harness.kind`) — what the runner is asked about. */
    harness?: string | null
}

export function ProviderCredentialsSection({harness, ...props}: ProviderCredentialsSectionProps) {
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const customSecrets = useAtomValue(customSecretsAtom)

    // `""` under "API key" — the family key is what keeps the query idle outside self-managed mode.
    const statusKey = subscriptionStatusKey({mode: props.mode, harness})
    const statusQuery = useAtomValue(
        useMemo(() => subscriptionStatusQueryAtomFamily(statusKey), [statusKey]),
    )
    const subscriptionStatus = resolveSubscriptionStatus({
        harness: statusKey,
        isLoading: statusQuery.isLoading,
        isError: statusQuery.isError,
        data: statusQuery.data,
    })
    const onCheckAgain = useCallback(() => {
        void statusQuery.refetch()
    }, [statusQuery])

    return (
        <ProviderCredentialsSectionView
            {...props}
            standardSecrets={standardSecrets}
            customSecrets={customSecrets}
            subscriptionStatus={subscriptionStatus}
            onCheckAgain={onCheckAgain}
        />
    )
}

export default ProviderCredentialsSection
