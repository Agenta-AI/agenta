import React, {useState} from "react"
import {CaretRight, Clock, Calendar} from "@phosphor-icons/react"
import {DatePicker, Button, Typography, Divider, Popover} from "antd"
import {JSSTheme} from "@/lib/Types"
import dayjs, {Dayjs} from "dayjs"
import type {SelectProps} from "antd"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        padding: theme.paddingXS,
    },
    customDateContainer: {
        flex: 1,
        padding: theme.paddingXS,
        gap: 16,
        display: "flex",
        flexDirection: "column",
    },
    popover: {
        "& .ant-popover-inner": {
            transition: "width 0.3s ease",
            padding: 4,
        },
    },
    popupItems: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: `5px ${theme.paddingContentHorizontal}px`,
        gap: theme.marginXS,
        borderRadius: theme.borderRadiusSM,
        cursor: "pointer",
        "&:hover": {
            backgroundColor: theme.controlItemBgActive,
        },
    },
    popupSelectedItem: {
        backgroundColor: theme.controlItemBgActive,
    },
}))

export type SortResult = {
    type: "custom" | "standard"
    sorted: string
    customRange?: {startTime?: string; endTime?: string}
}
type SortTypes =
    | "30 mins"
    | "1 hour"
    | "6 hour"
    | "24 hour"
    | "3 days"
    | "7 days"
    | "14 days"
    | "1 month"
    | "3 month"
    | "all time"
    | "custom"
    | ""
type CustomTimeRange = {
    startTime: Dayjs | null
    endTime: Dayjs | null
}
type Props = {
    onSortApply: ({type, sorted, customRange}: SortResult) => void
    defaultSortValue: SortTypes
}

const Sort: React.FC<Props> = ({onSortApply, defaultSortValue}) => {
    const classes = useStyles()

    const [sort, setSort] = useState<SortTypes>(defaultSortValue)
    const [customTime, setCustomTime] = useState<CustomTimeRange>({startTime: null, endTime: null})
    const [dropdownVisible, setDropdownVisible] = useState(false)
    const [customOptionSelected, setCustomOptionSelected] = useState(
        customTime.startTime == null ? false : true,
    )

    const apply = ({
        sortData,
        customRange,
    }: {
        sortData: SortTypes
        customRange?: CustomTimeRange
    }) => {
        let sortedTime
        let customRangeTime: {startTime?: string; endTime?: string} = {}

        if (sortData && sortData !== "custom" && sortData !== "all time") {
            const now = dayjs().utc()

            // Split the value into number and unit (e.g., "30 minutes" becomes ["30", "minutes"])
            const [amount, unit] = (sortData as SortTypes).split(" ")
            sortedTime = now
                .subtract(parseInt(amount), unit as dayjs.ManipulateType)
                .toISOString()
                .split(".")[0]
        } else if (sortData === "custom" && (customRange?.startTime || customRange?.endTime)) {
            if (customRange.startTime) {
                customRangeTime.startTime = dayjs(customRange.startTime)
                    .utc()
                    .toISOString()
                    .split(".")[0]
            }
            if (customRange.endTime) {
                customRangeTime.endTime = dayjs(customRange.endTime)
                    .utc()
                    .toISOString()
                    .split(".")[0]
            }
        } else if (sortData === "all time") {
            sortedTime = "1970-01-01T00:00:00"
        }

        onSortApply({
            type: sortData == "custom" ? "custom" : "standard",
            sorted: sortedTime as string,
            customRange: customRangeTime,
        })
    }

    const handleApplyCustomRange = () => {
        if (customTime.startTime || customTime.endTime) {
            apply({sortData: "custom", customRange: customTime})
            setDropdownVisible(false)
        }
    }

    const onSelectItem = (item: any) => {
        setDropdownVisible(false)
        setSort(item.value as SortTypes)
        apply({sortData: item.value as SortTypes})

        setTimeout(() => {
            setCustomOptionSelected(false)
        }, 500)

        if (customTime.startTime || customTime.endTime) {
            setCustomTime({startTime: null, endTime: null})
        }
    }

    const options: SelectProps["options"] = [
        {value: "30 minutes", label: "30 mins"},
        {value: "1 hour", label: "1 hour"},
        {value: "6 hours", label: "6 hours"},
        {value: "24 hours", label: "24 hours"},
        {value: "3 days", label: "3 days"},
        {value: "7 days", label: "7 days"},
        {value: "14 days", label: "14 days"},
        {value: "1 month", label: "1 month"},
        {value: "3 months", label: "3 months"},
        {value: "all time", label: "All time"},
    ]

    return (
        <>
            <Popover
                title={null}
                trigger="click"
                overlayClassName={`${classes.popover} ${customOptionSelected ? "!w-[536px]" : "!w-[256px]"} h-[345px]`}
                arrow={false}
                afterOpenChange={() => {
                    if (sort == "custom" && !customTime.startTime && !customTime.endTime) {
                        setSort(defaultSortValue)
                        setCustomOptionSelected(false)
                    }
                }}
                onOpenChange={() => setDropdownVisible(false)}
                open={dropdownVisible}
                placement="bottomLeft"
                content={
                    <section className="flex gap-2">
                        <div className="flex-1">
                            <div>
                                {options.map((item) => (
                                    <div
                                        key={item.value}
                                        onClick={() => onSelectItem(item)}
                                        className={`${classes.popupItems} ${sort === item.value && classes.popupSelectedItem}`}
                                    >
                                        {item.label}
                                    </div>
                                ))}

                                <div className="-ml-1 -mr-1.5">
                                    <Divider className="!my-1" />
                                </div>

                                <div
                                    className={`${classes.popupItems} ${sort === "custom" && classes.popupSelectedItem}`}
                                    onClick={() => {
                                        setCustomOptionSelected(true)
                                        setSort("custom")
                                    }}
                                >
                                    <Typography.Text className="flex items-center gap-2">
                                        <Clock size={12} /> Define start and end time
                                    </Typography.Text>
                                    <CaretRight size={12} />
                                </div>
                            </div>
                        </div>

                        {customOptionSelected && (
                            <>
                                <Divider className="!m-0 !h-[340px]" type="vertical" />

                                <div className="flex-1 flex flex-col justify-between">
                                    <div>
                                        <Typography.Text className={classes.title}>
                                            Start and end time
                                        </Typography.Text>

                                        <div className={classes.customDateContainer}>
                                            <div className="w-full flex flex-col gap-1">
                                                <Typography.Text>Start time</Typography.Text>
                                                <DatePicker
                                                    showTime
                                                    value={customTime.startTime}
                                                    format="HH:mm:ss DD MMM YYYY"
                                                    onChange={(date) =>
                                                        setCustomTime({
                                                            ...customTime,
                                                            startTime: date,
                                                        })
                                                    }
                                                    style={{width: "100%"}}
                                                />
                                            </div>

                                            <div className="w-full flex flex-col gap-1">
                                                <Typography.Text>End time</Typography.Text>
                                                <DatePicker
                                                    showTime
                                                    value={customTime.endTime}
                                                    format="HH:mm:ss DD MMM YYYY"
                                                    onChange={(date) =>
                                                        setCustomTime({
                                                            ...customTime,
                                                            endTime: date,
                                                        })
                                                    }
                                                    style={{width: "100%"}}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-end gap-2 p-1">
                                        <Button
                                            onClick={() => {
                                                setDropdownVisible(false)
                                                setCustomTime({startTime: null, endTime: null})
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="primary"
                                            onClick={handleApplyCustomRange}
                                            disabled={!customTime.startTime && !customTime.endTime}
                                        >
                                            Apply
                                        </Button>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>
                }
            >
                <Button
                    icon={<Calendar size={14} className="mt-0.5" />}
                    onClick={() => setDropdownVisible(true)}
                    className="flex items-center gap-2"
                >
                    {sort ? (
                        <>
                            {sort === "custom" ? (
                                "Custom date"
                            ) : sort === "all time" ? (
                                "All time"
                            ) : (
                                <>Last {sort}</>
                            )}
                        </>
                    ) : (
                        "Sort by Date"
                    )}
                </Button>
            </Popover>
        </>
    )
}

export default Sort
