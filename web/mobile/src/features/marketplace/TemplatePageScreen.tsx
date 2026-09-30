import {
    agentTemplateLookupAtomFamily,
    agentTemplateProvenanceAtom,
    agentTemplatesAtom,
    refetchAgentTemplatesAtom,
} from "@agenta/entities/workflow"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {LoadingButton} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useScrollFade} from "@/lib/useScrollFade"

import {useNewAgentAction} from "../agents/useNewAgentAction"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {TemplateNotFound} from "./states/TemplateNotFound"
import {TemplatePageSkeleton} from "./states/TemplatePageSkeleton"
import {TemplatePage} from "./TemplatePage"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** A marketplace template's own page; "Use this template" runs the app's one template create. */
export const TemplatePageScreen = ({
    workspaceId,
    projectId,
    templateKey,
}: {
    workspaceId: string
    projectId: string
    templateKey: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const marketplaceHref = `${base}/templates`
    const newAgent = useNewAgentAction(base)
    const fade = useScrollFade<HTMLDivElement>()
    const lookup = useAtomValue(agentTemplateLookupAtomFamily(templateKey))
    const all = useAtomValue(agentTemplatesAtom)
    const provenance = useAtomValue(agentTemplateProvenanceAtom)
    const refetchTemplates = useSetAtom(refetchAgentTemplatesAtom)
    const template = lookup.template
    const use = () => {
        if (template) newAgent.createFromTemplate(template.key)
    }

    return (
        <>
            <PageTitle title="Agent Marketplace" context={template?.name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    scrollRef={fade.ref}
                    onScroll={fade.onScroll}
                    scrollStyle={fade.style}
                    header={
                        <div className="box-border flex shrink-0 items-center gap-2 px-4 pb-1 pt-3 lg:hidden">
                            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                        </div>
                    }
                    footer={
                        template ? (
                            <div className="box-border shrink-0 border-x-0 lg:hidden border-b-0 border-t border-solid border-border bg-background px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
                                <LoadingButton
                                    loading={newAgent.creating}
                                    onClick={use}
                                    className="w-full"
                                >
                                    Use this template
                                </LoadingButton>
                            </div>
                        ) : undefined
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 lg:pt-14 ${PAGE_FRAME}`}>
                        {template ? (
                            <TemplatePage
                                template={template}
                                all={all}
                                provenance={provenance[template.key]}
                                marketplaceHref={marketplaceHref}
                                busy={newAgent.creating}
                                onUse={use}
                            />
                        ) : lookup.status === "error" ? (
                            <LoadError
                                framed
                                title="Could not load this template"
                                onRetry={refetchTemplates}
                            />
                        ) : lookup.status === "missing" ? (
                            <TemplateNotFound marketplaceHref={marketplaceHref} />
                        ) : (
                            <TemplatePageSkeleton />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
