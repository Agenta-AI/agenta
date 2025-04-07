import {Dispatch, memo, SetStateAction} from "react"

import {Input, Typography} from "antd"

import {COMMIT_MESSAGE_MAX_LENGTH} from "@/oss/config/constants"

const CommitNote = ({note, setNote}: {note: string; setNote: Dispatch<SetStateAction<string>>}) => {
    return (
        <div className="flex flex-col gap-1">
            <Typography.Text>
                Notes <span className="text-[#758391]">(optional)</span>
            </Typography.Text>
            <Input.TextArea
                placeholder="Describe why you are deploying"
                className="w-full mb-4"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                showCount
                maxLength={COMMIT_MESSAGE_MAX_LENGTH}
            />
        </div>
    )
}

export default memo(CommitNote)
