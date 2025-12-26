import {memo} from "react"

import {Tag} from "antd"

const EvaluatorTagsCell = memo(({tags}: {tags: string[]}) => {
    if (!tags?.length) return null

    return (
        <div className="flex flex-nowrap items-center gap-2">
            {tags.map((tag) => (
                <Tag key={tag} variant="filled" className="bg-[#0517290F]">
                    {tag}
                </Tag>
            ))}
        </div>
    )
})

export default EvaluatorTagsCell
