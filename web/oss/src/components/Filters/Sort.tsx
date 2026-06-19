import {useState} from "react"

import {Calendar, CaretRight, Clock} from "@phosphor-icons/react"
import type {SelectProps} from "antd"
import {Button, DatePicker, Divider, Popover, Typography} from "antd"
import dayjs, {Dayjs} from "dayjs"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

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
        "& .ant-popover-container": {
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

export interface SortResult {
    type: "custom" | "standard"
    sorted: string
    customRange?: {startTime?: string; endTime?: string}
    label?: SortTypes
}
export type SortTypes =
    | "30 mins"
    | "1 hour"
    | "6 hours"
    | "24 hours"
    | "3 days"
    | "7 days"
    | "14 days"
    | "1 month"
    | "3 months"
    | "all time"
    | "custom"
    | ""
interface SortPresetMeta {
    label: SortTypes
    amount?: number
    unit?: dayjs.ManipulateType
}
interface CustomTimeRange {
    startTime: Dayjs | null
    endTime: Dayjs | null
}
interface Props {
    onSortApply: ({type, sorted, customRange}: SortResult) => void
    defaultSortValue: SortTypes
    type?: "link" | "text" | "default" | "primary" | "dashed"
    disabled?: boolean
    exclude?: SortTypes[]
}

const SORT_PRESETS: SortPresetMeta[] = [
    {label: "30 mins", amount: 30, unit: "minute"},
    {label: "1 hour", amount: 1, unit: "hour"},
    {label: "6 hours", amount: 6, unit: "hour"},
    {label: "24 hours", amount: 24, unit: "hour"},
    {label: "3 days", amount: 3, unit: "day"},
    {label: "7 days", amount: 7, unit: "day"},
    {label: "14 days", amount: 14, unit: "day"},
    {label: "1 month", amount: 1, unit: "month"},
    {label: "3 months", amount: 3, unit: "month"},
    {label: "all time"},
]

const Sort: React.FC<Props> = ({onSortApply, defaultSortValue, type, disabled, exclude}) => {
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
        const customRangeTime: {startTime?: string; endTime?: string} = {}
        const preset = SORT_PRESETS.find((item) => item.label === sortData)

        if (preset?.amount && preset.unit) {
            const now = dayjs().utc()

            sortedTime = now.subtract(preset.amount, preset.unit).toISOString().split(".")[0]
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
            label: sortData,
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

    const options: SelectProps["options"] = SORT_PRESETS.map((preset) => ({
        value: preset.label,
        label: preset.label === "all time" ? "All time" : preset.label,
    }))

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
                                {options
                                    .filter(
                                        (item) =>
                                            !exclude?.includes(item.value as SortTypes) &&
                                            !exclude?.includes(item.label as SortTypes),
                                    )
                                    .map((item) => (
                                        <div
                                            key={item.value}
                                            onClick={() => onSelectItem(item)}
                                            className={`${classes.popupItems} ${sort === item.value && classes.popupSelectedItem}`}
                                        >
                                            {item.label}
                                        </div>
                                    ))}

                                {!exclude?.includes("custom") && (
                                    <>
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
                                    </>
                                )}
                            </div>
                        </div>

                        {customOptionSelected && (
                            <>
                                <Divider className="!m-0 !h-[340px]" orientation="vertical" />

                                <div className="flex-1 flex flex-col justify-between pt-2">
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
                    type={type}
                    disabled={disabled}
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
