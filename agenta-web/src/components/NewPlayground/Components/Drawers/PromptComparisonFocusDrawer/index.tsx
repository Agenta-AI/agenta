import {useMemo} from "react"
import useDrawerWidth from "@/components/NewPlayground/hooks/useDrawerWidth"
import {Drawer, Tabs, TabsProps} from "antd"
import {PromptComparisonFocusDrawerProps} from "./types"
import {useStyles} from "./styles"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import PlaygroundVariantConfig from "../../PlaygroundVariantConfig"
import PromptComparisonWrapper from "../../PlaygroundPromptComparisonView/PromptComparisonWrapper"

const PromptComparisonFocusDrawer: React.FC<PromptComparisonFocusDrawerProps> = ({...props}) => {
    const classes = useStyles()
    const {drawerWidth} = useDrawerWidth()
    const {variantIds} = usePlayground()

    const onClose = (e: any) => {
        props?.onClose?.(e)
    }

    const onChange = (key: string) => {
        console.log(key)
    }

    const items: TabsProps["items"] = useMemo(
        () => [
            {
                key: "1",
                label: "Tab 1",
            },
            {
                key: "2",
                label: "Tab 2",
            },
        ],
        [],
    )

    return (
        <>
            <Drawer
                placement={"right"}
                classNames={{body: "!p-0"}}
                width={drawerWidth}
                onClose={onClose}
                title="Variant view"
                {...props}
            >
                <section className="w-full overflow-auto">
                    <Tabs
                        className={classes.tabHeader}
                        defaultActiveKey="1"
                        items={items}
                        onChange={onChange}
                    />

                    <div className="w-full flex items-start">
                        {(variantIds || []).map((variantId) => (
                            <PromptComparisonWrapper key={variantId}>
                                <PlaygroundVariantConfig variantId={variantId as string} />
                            </PromptComparisonWrapper>
                        ))}
                    </div>
                </section>
            </Drawer>
        </>
    )
}

export default PromptComparisonFocusDrawer
