import React, {useState} from "react"
import {Hourglass} from "@phosphor-icons/react"
import {Select} from "antd"
import {SortTypes} from "@/lib/Types"

type Props = {
    onSortApply: (sort: SortTypes) => void
    defaultSortValue: SortTypes
}

const Sort: React.FC<Props> = ({onSortApply, defaultSortValue}) => {
    const [sort, setSort] = useState<SortTypes>(defaultSortValue)

    return (
        <Select
            style={{width: 120}}
            suffixIcon={null}
            value={sort}
            onChange={(value) => {
                setSort(value)
                onSortApply(value)
            }}
            labelRender={(value) => (
                <div className="flex items-center justify-center gap-2">
                    <Hourglass size={14} />{" "}
                    {sort ? (
                        <>
                            {sort !== "all time" && "Last"} {value.value}
                        </>
                    ) : (
                        "Sort by Date"
                    )}
                </div>
            )}
            options={[
                {value: "30 mins", label: "30 mins"},
                {value: "1 hour", label: "1 hour"},
                {value: "6 hour", label: "6 hour"},
                {value: "24 hour", label: "24 hour"},
                {value: "3 days", label: "3 days"},
                {value: "7 days", label: "7 days"},
                {value: "14 days", label: "14 days"},
                {value: "1 month", label: "1 month"},
                {value: "3 month", label: "3 month"},
                {value: "all time", label: "All time"},
            ]}
        />
    )
}

export default Sort
