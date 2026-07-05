import {useMemo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {DotsThreeVertical, PencilSimple} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {runFlagsAtomFamily} from "../atoms/runDerived"
import {editEvaluationDrawerRunIdAtom} from "../state/editDrawer"
import {previewEvalTypeAtom} from "../state/evalType"

const RunActionsDropdown = ({runId}: {runId: string}) => {
    const openEdit = useSetAtom(editEvaluationDrawerRunIdAtom)
    const runFlags = useAtomValue(useMemo(() => runFlagsAtomFamily(runId), [runId]))
    const evalType = useAtomValue(previewEvalTypeAtom)

    const canEdit = evalType !== "online" && runFlags?.isClosed !== true
    if (!canEdit) return null

    return (
        <DropdownMenu>
            <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                <Button aria-label="Run actions" variant="ghost" size="icon-sm">
                    {<DotsThreeVertical size={18} weight="bold" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                <DropdownMenuItem onClick={() => openEdit(runId)}>
                    <PencilSimple size={16} />
                    Edit evaluation
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default RunActionsDropdown
