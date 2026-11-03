import {useState} from "react"

import {Badge, Button} from "@agenta/ui/ui"
import {CaretDownIcon, CaretRightIcon} from "@phosphor-icons/react"

import {useRevisionParam} from "../../revisions/useRevisionParam"

import {ConfigJsonDisclosure} from "./ConfigJsonDisclosure"
import {ConfigRows} from "./ConfigRows"
import type {EvaluatorConfig} from "./useEvaluatorConfigs"

const MISSING = "—"

/** A setting as one line of text: a string as it is, anything else as compact JSON. */
const settingText = (value: unknown): string =>
    typeof value === "string" ? value : (JSON.stringify(value) ?? MISSING)

/**
 * One evaluator of the run: its name (opens the revision drawer), version, description and
 * settings. The card collapses; a run that names no revision shows "Latest" instead of a version.
 */
export const EvaluatorConfigCard = ({
    evaluator,
    defaultOpen,
}: {
    evaluator: EvaluatorConfig
    defaultOpen: boolean
}) => {
    const [open, setOpen] = useState(defaultOpen)
    const [, setRevisionId] = useRevisionParam()
    const {name, description, version, latest, revisionId, settings} = evaluator

    const settingRows = Object.entries(settings ?? {}).map(([key, value]) => ({
        key,
        label: key,
        value: (
            <span className="whitespace-pre-wrap break-words font-mono text-xs">
                {settingText(value)}
            </span>
        ),
    }))

    return (
        <div
            data-testid="evaluator-card"
            className="box-border flex min-w-0 flex-col gap-3 rounded-md border border-solid border-border p-3"
        >
            <div className="flex min-w-0 items-start gap-2">
                <button
                    type="button"
                    aria-expanded={open}
                    aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
                    onClick={() => setOpen((current) => !current)}
                    className="m-0 mt-0.5 flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground"
                >
                    {open ? <CaretDownIcon aria-hidden /> : <CaretRightIcon aria-hidden />}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Button
                            variant="link"
                            className="h-auto min-w-0 justify-start p-0 text-left font-semibold"
                            disabled={!revisionId}
                            onClick={() => revisionId && setRevisionId(revisionId)}
                        >
                            <span className="truncate">{name}</span>
                        </Button>
                        {latest ? (
                            <Badge variant="outlined">Latest</Badge>
                        ) : version === null ? null : (
                            <Badge variant="outlined">V{version}</Badge>
                        )}
                    </div>
                    {description && !open ? (
                        <p className="m-0 truncate text-sm text-muted-foreground">{description}</p>
                    ) : null}
                </div>
            </div>
            {open ? (
                <div className="flex min-w-0 flex-col gap-3">
                    {description ? (
                        <p className="m-0 break-words text-sm text-muted-foreground">
                            {description}
                        </p>
                    ) : null}
                    {settingRows.length > 0 ? <ConfigRows rows={settingRows} /> : null}
                    <ConfigJsonDisclosure value={evaluator.snapshot} />
                </div>
            ) : null}
        </div>
    )
}
