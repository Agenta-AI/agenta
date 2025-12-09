import {useMemo} from "react"

import {Rows} from "@phosphor-icons/react"
import type {MenuProps} from "antd"
import {useAtom} from "jotai"

import {ROW_HEIGHT_CONFIG, scenarioRowHeightAtom, type ScenarioRowHeight} from "../state/rowHeight"

const ROW_HEIGHT_OPTIONS: ScenarioRowHeight[] = ["small", "medium", "large"]

/**
 * Hook that returns menu items for row height selection in the settings dropdown
 */
const useRowHeightMenuItems = (): MenuProps["items"] => {
    const [rowHeight, setRowHeight] = useAtom(scenarioRowHeightAtom)

    return useMemo(() => {
        const items: MenuProps["items"] = [
            {
                key: "row-height",
                label: "Row height",
                icon: <Rows size={16} />,
                children: ROW_HEIGHT_OPTIONS.map((height) => ({
                    key: `row-height-${height}`,
                    label: ROW_HEIGHT_CONFIG[height].label,
                    onClick: () => setRowHeight(height),
                    style: rowHeight === height ? {fontWeight: 600} : undefined,
                })),
            },
        ]
        return items
    }, [rowHeight, setRowHeight])
}

export default useRowHeightMenuItems
