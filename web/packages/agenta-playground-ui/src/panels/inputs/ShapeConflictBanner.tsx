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
export const ShapeConflictBanner = ({conflicts, onAdopt}: ShapeConflictBannerProps) => (
    <Alert
        type="warning"
        showIcon
        icon={<Warning />}
        className="text-xs"
        message={
            <span className="font-normal">
                The prompt now expects nested fields at{" "}
                {conflicts.map((conflict, index) => (
                    <span key={conflict.key}>
                        {index > 0 ? ", " : ""}
                        <code className="rounded border border-solid border-border bg-background px-1 font-mono">
                            {conflict.key}
                        </code>
                    </span>
                ))}
                . Adopting the new shape will discard your current scalar value
                {conflicts.length > 1 ? "s" : ""}.
            </span>
        }
        action={
            <Button variant="outline" size="sm" onClick={onAdopt}>
                Use prompt shape
            </Button>
        }
    />
)
