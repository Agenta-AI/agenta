import {Badge, Button} from "@agenta/ui/ui"

import {useRevisionParam} from "../../revisions/useRevisionParam"

import {ConfigJsonDisclosure} from "./ConfigJsonDisclosure"
import {ConfigRows, type ConfigRowData} from "./ConfigRows"
import {ConfigSection} from "./ConfigSection"
import type {ApplicationConfig} from "./useApplicationConfig"

const MISSING = "—"
const NO_SCHEMA_NOTE = "No playground schema — snapshot available as JSON"

/**
 * The Application section: the app, its variant and version, and its configuration. "Open
 * variant" opens the revision in the revision drawer; the JSON shows the stored revision as it is.
 */
export const ApplicationConfigSection = ({application}: {application: ApplicationConfig}) => {
    const [, setRevisionId] = useRevisionParam()
    const {appName, variantName, version, customWithoutSchema} = application

    const subtitle = [appName, variantName, version === null ? null : `v${version}`]
        .filter(Boolean)
        .join(" · ")

    if (application.appFailed && !appName) {
        return (
            <ConfigSection id="config-application" title="Application">
                <p className="m-0 text-sm text-muted-foreground">
                    Application metadata unavailable.
                </p>
            </ConfigSection>
        )
    }

    const rows: ConfigRowData[] = [
        {key: "application", label: "Application", value: appName ?? MISSING},
        {
            key: "variant",
            label: "Variant",
            value: variantName ? (
                <span className="inline-flex flex-wrap items-center gap-1">
                    {variantName}
                    {version === null ? null : <Badge variant="outlined">v{version}</Badge>}
                </span>
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
        <ConfigSection id="config-application" title="Application" subtitle={subtitle || null}>
            <ConfigRows rows={rows} />
            {application.configFailed ? (
                <p className="m-0 text-sm text-muted-foreground">
                    Variant configuration unavailable.
                </p>
            ) : (
                <div className="flex min-w-0 flex-col gap-3">
                    {customWithoutSchema ? null : (
                        <Button
                            variant="outline"
                            size="sm"
                            className="self-start"
                            onClick={() => setRevisionId(application.revisionId)}
                        >
                            Open variant
                        </Button>
                    )}
                    <ConfigJsonDisclosure
                        // defaultOpen is read once, so a custom workflow found after the first
                        // render needs a fresh disclosure to start open.
                        key={customWithoutSchema ? "open" : "closed"}
                        value={application.snapshot}
                        defaultOpen={customWithoutSchema}
                    />
                </div>
            )}
        </ConfigSection>
    )
}
