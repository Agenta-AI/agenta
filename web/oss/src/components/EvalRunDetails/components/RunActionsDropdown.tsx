import {useMemo} from "react"

import {DotsThreeVertical, PencilSimple} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {runFlagsAtomFamily} from "../atoms/runDerived"
import {editEvaluationDrawerRunIdAtom} from "../state/editDrawer"
import {previewEvalTypeAtom} from "../state/evalType"

/**
 * Actions dropdown rendered next to the run name in the run-details header. Lives in the
 * page header so "Edit evaluation" is reachable from every tab (Overview / Scenarios /
 * Configuration), mirroring the testset page's name-adjacent actions menu. Opens the
 * shared Edit drawer via `editEvaluationDrawerRunIdAtom`. Built as a menu so more run
 * actions (duplicate, delete, …) can slot in later.
 */
const RunActionsDropdown = ({runId}: {runId: string}) => {
    const openEdit = useSetAtom(editEvaluationDrawerRunIdAtom)
    const runFlags = useAtomValue(useMemo(() => runFlagsAtomFamily(runId), [runId]))
    const evalType = useAtomValue(previewEvalTypeAtom)

    // Online runs aren't edited through this drawer; a closed run is immutable.
    const canEdit = evalType !== "online" && runFlags?.isClosed !== true
    if (!canEdit) return null

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                items: [{key: "edit", label: "Edit evaluation", icon: <PencilSimple size={16} />}],
                onClick: ({key}) => {
                    if (key === "edit") openEdit(runId)
                },
            }}
        >
            <Button
                type="text"
                size="small"
                aria-label="Run actions"
                icon={<DotsThreeVertical size={18} weight="bold" />}
            />
        </Dropdown>
    )
}

export default RunActionsDropdown
