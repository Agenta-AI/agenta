import {richText, useT} from "@agenta/i18n"
import inputsCatalog from "@agenta/i18n/catalogs/playground.inputs"
import {Alert, Button} from "@agenta/ui/ui"
import {Warning} from "@phosphor-icons/react"

import type {ShapeConflict} from "../../utils/variableShape"

export interface ShapeConflictBannerProps {
    conflicts: ShapeConflict[]
    onAdopt: () => void
}

/**
 * Shown when the prompt now expects nested fields where the test case holds a plain value. The
 * button replaces the plain value with the shape the prompt expects.
 */
export const ShapeConflictBanner = ({conflicts, onAdopt}: ShapeConflictBannerProps) => {
    const t = useT(inputsCatalog)
    return (
        <Alert
            type="warning"
            showIcon
            icon={<Warning />}
            className="text-xs"
            message={
                <span className="font-normal">
                    {richText(
                        t(
                            conflicts.length > 1
                                ? "playground.inputs.shapeConflictMany"
                                : "playground.inputs.shapeConflict",
                            {
                                keys: "<keys></keys>",
                            },
                        ),
                        {
                            keys: () =>
                                conflicts.map((conflict, index) => (
                                    <span key={conflict.key}>
                                        {index > 0 ? ", " : ""}
                                        <code className="rounded border border-solid border-border bg-background px-1 font-mono">
                                            {conflict.key}
                                        </code>
                                    </span>
                                )),
                        },
                    )}
                </span>
            }
            action={
                <Button variant="outline" size="sm" onClick={onAdopt}>
                    {t("playground.inputs.usePromptShape")}
                </Button>
            }
        />
    )
}
