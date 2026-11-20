import {agentSharingQueryAtomFamily} from "@agenta/entities/sharing"
import {useT} from "@agenta/i18n"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import {LockSimple} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

/** A lock with "Only you can see and use it in Agenta." when the agent is private. */
export const PrivateMark = ({agentId}: {agentId: string}) => {
    const t = useT(builderPageCatalog)
    const isPrivate =
        useAtomValue(agentSharingQueryAtomFamily(agentId)).data?.sharing.policy.visibility ===
        "private"
    if (!isPrivate) return null
    return (
        <span title={t("builder.page.privateAgent")} className="flex shrink-0">
            <LockSimple
                size={12}
                className="text-colorTextTertiary"
                aria-label={t("builder.page.privateAgent")}
            />
        </span>
    )
}
