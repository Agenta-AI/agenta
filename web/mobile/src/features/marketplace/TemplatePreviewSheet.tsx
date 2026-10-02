import type {CSSProperties} from "react"

import type {AgentStarterTemplate} from "@agenta/entities/workflow"
import {
    Button,
    LoadingButton,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"
import {ArrowRightIcon, CaretDownIcon, CaretUpIcon} from "@phosphor-icons/react"
import Link from "next/link"

import {AppTileStack} from "./AppTileStack"
import {ExampleRun} from "./ExampleRun"
import {HowItWorksSteps} from "./HowItWorksSteps"
import {howItWorks, templateProviders, templateTools} from "./marketplaceView"
import {SectionLabel} from "./SectionLabel"
import {TemplateConnectList} from "./TemplateConnectList"
import {TemplateToolList} from "./TemplateToolList"

const SHEET_WIDTH = {"--ag-sheet-responsive-width": "560px"} as CSSProperties

/** A template read in place, beside the catalog: what it does, then use it or open its page. */
export const TemplatePreviewSheet = ({
    open,
    template,
    fullPageHref,
    busy,
    onUse,
    onStep,
    onClose,
}: {
    /** Separate from `template`, so the last one stays drawn while the sheet closes. */
    open: boolean
    template: AgentStarterTemplate | undefined
    fullPageHref: string
    busy: boolean
    onUse: (template: AgentStarterTemplate) => void
    /** Move to the previous (-1) or next (1) template in the current results. */
    onStep: (direction: -1 | 1) => void
    onClose: () => void
}) => {
    const tools = template ? templateTools(template) : []
    return (
        <Sheet open={open && Boolean(template)} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="responsive" style={SHEET_WIDTH} className="overflow-hidden">
                {template ? (
                    <>
                        <SheetHeader className="py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                                <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                                    Agent Marketplace /{" "}
                                    <span className="text-foreground">{template.category}</span>
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Previous template"
                                    onClick={() => onStep(-1)}
                                >
                                    <CaretUpIcon />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Next template"
                                    onClick={() => onStep(1)}
                                >
                                    <CaretDownIcon />
                                </Button>
                            </div>
                        </SheetHeader>

                        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-5 lg:px-6">
                            <div className="flex flex-col gap-3">
                                <AppTileStack apps={templateProviders(template)} size="lg" />
                                <SheetTitle className="text-xl font-semibold">
                                    {template.name}
                                </SheetTitle>
                                <SheetDescription className="text-sm leading-relaxed">
                                    {template.overview || template.description}
                                </SheetDescription>
                            </div>

                            {template.example ? (
                                <ExampleRun key={template.key} example={template.example} />
                            ) : null}

                            <section className="flex flex-col gap-3">
                                <SectionLabel as="h3">Connects</SectionLabel>
                                <TemplateConnectList template={template} />
                            </section>

                            <section className="flex flex-col gap-3">
                                <SectionLabel as="h3">How it works</SectionLabel>
                                <HowItWorksSteps steps={howItWorks(template)} />
                            </section>

                            {tools.length ? (
                                <section className="flex flex-col gap-3">
                                    <SectionLabel as="h3">Tools it can use</SectionLabel>
                                    <TemplateToolList tools={tools} />
                                </section>
                            ) : null}
                        </div>

                        <SheetFooter className="flex-row sm:justify-stretch">
                            <LoadingButton
                                loading={busy}
                                className="flex-1"
                                onClick={() => onUse(template)}
                            >
                                Use this template
                            </LoadingButton>
                            <Button variant="outline" asChild>
                                <Link href={fullPageHref}>
                                    Open full page
                                    <ArrowRightIcon data-icon="inline-end" />
                                </Link>
                            </Button>
                        </SheetFooter>
                    </>
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
