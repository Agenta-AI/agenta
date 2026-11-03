import {useMemo} from "react"

import type {TableMenuItem} from "@agenta/ui/table"
import {Rows} from "@phosphor-icons/react"
import {useAtom} from "jotai"

import {ROW_HEIGHT_CONFIG, scenarioRowHeightAtom, type ScenarioRowHeight} from "../state/rowHeight"

const ROW_HEIGHT_OPTIONS: ScenarioRowHeight[] = ["small", "medium", "large"]

/**
 * Hook that returns menu items for row height selection in the settings dropdown
 */
const useRowHeightMenuItems = (): TableMenuItem[] => {
    const [rowHeight, setRowHeight] = useAtom(scenarioRowHeightAtom)

    return useMemo(
        () => [
            {
                key: "row-height",
                label: "Row height",
                icon: <Rows size={16} />,
                children: ROW_HEIGHT_OPTIONS.map((height) => ({
                    key: `row-height-${height}`,
                    label: (
                        <span className={rowHeight === height ? "font-semibold" : undefined}>
                            {ROW_HEIGHT_CONFIG[height].label}
                        </span>
                    ),
                    onClick: () => setRowHeight(height),
                })),
            },
        ],
        [rowHeight, setRowHeight],
    )
}

export default useRowHeightMenuItems
