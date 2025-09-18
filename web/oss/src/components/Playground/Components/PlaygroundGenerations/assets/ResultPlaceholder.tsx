import {FC} from "react"

import SharedEditor from "../../SharedEditor"

export const ResultPlaceholder = ({message}: {message: string}) => (
    <SharedEditor initialValue={message} editorType="borderless" readOnly disabled />
)

export const RunningPlaceholder = () => <ResultPlaceholder message="Running..." />

// Visually align with TypingIndicator (same container classes) to avoid layout shift
export const ClickRunPlaceholder: FC = () => {
    return (
        <div className="w-full px-3 py-2 rounded-md bg-[#fafafa] text-[13px] text-gray-600 border border-solid border-[rgba(5,23,41,0.06)]">
            <span>Click run (Ctrl+Enter / ⌘+Enter) to generate output</span>
        </div>
    )
}

export default ResultPlaceholder
