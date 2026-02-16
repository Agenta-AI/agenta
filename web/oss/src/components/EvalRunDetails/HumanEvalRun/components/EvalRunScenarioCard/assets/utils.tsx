import {Skeleton} from "antd"

export function renderSkeleton() {
    return (
        <div className="flex flex-col gap-4 w-full">
            <Skeleton active title={false} paragraph={{rows: 4}} />
        </div>
    )
}
