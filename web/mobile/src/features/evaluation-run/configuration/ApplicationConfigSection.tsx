import {SkeletonBlock} from "@agenta/ui/ui"
import {GitCommit, SquaresFour} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {RunReferenceChip} from "../overview/RunReferenceChip"
import {useRunReferenceLinks} from "../overview/useRunReferenceLinks"

import {ConfigJsonDisclosure} from "./ConfigJsonDisclosure"
import {ConfigRows, type ConfigRowData} from "./ConfigRows"
import {ConfigSection} from "./ConfigSection"
import type {ApplicationConfig} from "./useApplicationConfig"

// The prompt view carries the editors: it loads only with this section.
const RevisionConfigView = dynamic(
    () => import("@agenta/entity-ui/variant/config").then((m) => m.RevisionConfigView),
    {ssr: false, loading: () => <SkeletonBlock className="h-40 w-full rounded-md" />},
)

const MISSING = "—"
const NO_SCHEMA_NOTE = "No playground schema — snapshot available as JSON"

/**
 * The Application section: the app and its variant as chips (the variant links to its revision
 * when the variants page is on), and the prompt template the run used, read only, as a form, JSON
 * or YAML. A custom workflow without a schema shows its stored JSON.
 */
export const ApplicationConfigSection = ({
    application,
    idSuffix = "",
    diff,
}: {
    application: ApplicationConfig
    /** Compare mode: which fields differ from the base run's. */
    diff?: {app: boolean; variant: boolean}
    /** Keeps the section id unique when several runs show side by side. */
    idSuffix?: string
}) => {
    const links = useRunReferenceLinks()
    const {appName, variantName, version, customWithoutSchema} = application

    const subtitle = [appName, variantName, version === null ? null : `v${version}`]
        .filter(Boolean)
        .join(" · ")

    if (application.appFailed && !appName) {
        return (
            <ConfigSection id={`config-application${idSuffix}`} title="Application">
                <p className="m-0 text-sm text-muted-foreground">
                    Application metadata unavailable.
                </p>
            </ConfigSection>
        )
    }

    const rows: ConfigRowData[] = [
        {
            key: "application",
            label: "Application",
            differs: diff?.app,
            value: appName ? (
                <RunReferenceChip icon={<SquaresFour size={14} />} label={appName} />
            ) : (
                MISSING
            ),
        },
        {
            key: "variant",
            label: "Variant",
            differs: diff?.variant,
            value: variantName ? (
                <RunReferenceChip
                    icon={<GitCommit size={14} />}
                    label={variantName}
                    version={version}
                    href={links.variant(application.applicationId, application.revisionId)}
                />
            ) : (
                MISSING
            ),
        },
        {
            key: "type",
            label: "Type",
            value: customWithoutSchema ? (
                <span className="flex flex-col gap-0.5">
                    Custom workflow
                    <span className="text-muted-foreground">{NO_SCHEMA_NOTE}</span>
                </span>
            ) : (
                "Workflow"
            ),
        },
    ]

    return (
        <ConfigSection
            id={`config-application${idSuffix}`}
            title="Application"
            subtitle={subtitle || null}
        >
            <ConfigRows rows={rows} />
            {application.configFailed ? (
                <p className="m-0 text-sm text-muted-foreground">
                    Variant configuration unavailable.
                </p>
            ) : customWithoutSchema ? (
                <ConfigJsonDisclosure value={application.snapshot} defaultOpen />
            ) : (
                <section aria-label="Prompt Template" className="flex min-w-0 flex-col gap-2">
                    <h3 className="m-0 text-sm font-semibold text-foreground">Prompt Template</h3>
                    <RevisionConfigView revisionId={application.revisionId} kind="variant" />
                </section>
            )}
        </ConfigSection>
    )
}
