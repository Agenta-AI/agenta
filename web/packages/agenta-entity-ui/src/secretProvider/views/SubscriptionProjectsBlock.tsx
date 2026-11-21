import {WarningCircle} from "@phosphor-icons/react"

import OrganizationProjectsSection, {
    type OrganizationConnectionScope,
} from "../OrganizationProjectsSection"
import type {useOrganizationProjectsDraft} from "../useOrganizationProjectsDraft"

/** An organization subscription's "Projects that can use it", with the failure of its save. */
export const SubscriptionProjectsBlock = ({
    organization,
    draft,
}: {
    organization: OrganizationConnectionScope
    draft: ReturnType<typeof useOrganizationProjectsDraft>
}) => (
    <div className="flex flex-col gap-2 text-xs">
        <OrganizationProjectsSection
            scope={organization}
            value={draft.projects}
            onChange={draft.setProjects}
            saved={draft.saved}
        />
        {draft.error ? (
            <p role="alert" className="m-0 flex items-center gap-1.5 text-colorError">
                <WarningCircle size={14} />
                {draft.error}
            </p>
        ) : null}
    </div>
)
