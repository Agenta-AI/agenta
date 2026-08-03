/**
 * ProviderCredentialsSection — the container for the "Provider credentials" pane.
 *
 * It owns exactly one thing: the project vault reads (`standardSecretsAtom` /
 * `customSecretsAtom`). Everything that renders lives in `ProviderCredentialsSectionView`,
 * which takes those secrets as props — the container/presentational split that makes the pane
 * storiable with plain data. Key WRITES stay inside `ProviderKeyField` (immediate save, no
 * drawer Save step; design.md §3.1).
 *
 * Design: docs/design/connect-model-drawer/design.md §3, §7, §8.
 */
import {customSecretsAtom, standardSecretsAtom} from "@agenta/entities/secret"
import {useAtomValue} from "jotai"

import {
    ProviderCredentialsSectionView,
    type ProviderCredentialsSectionViewProps,
} from "./ProviderCredentialsSectionView"

export type ProviderCredentialsSectionProps = Omit<
    ProviderCredentialsSectionViewProps,
    "standardSecrets" | "customSecrets"
>

export function ProviderCredentialsSection(props: ProviderCredentialsSectionProps) {
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const customSecrets = useAtomValue(customSecretsAtom)

    return (
        <ProviderCredentialsSectionView
            {...props}
            standardSecrets={standardSecrets}
            customSecrets={customSecrets}
        />
    )
}

export default ProviderCredentialsSection
