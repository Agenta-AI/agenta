import {useMemo} from "react"
import useDrawerWidth from "@/components/PlaygroundTest/hooks/useDrawerWidth"
import {Drawer, Tabs, TabsProps} from "antd"
import {PlaygroundComparisionPromptFocusDrawerProps} from "./types"
import {useStyles} from "./styles"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import PlaygroundVariantConfig from "../../PlaygroundVariantConfig"
import PlaygroundComparisionPromptConfig from "../../PlaygroundComparisionView/assets/PlaygroundComparisionPromptConfig/PlaygroundComparisionPromptConfig"

const PlaygroundComparisionPromptFocusDrawer: React.FC<
    PlaygroundComparisionPromptFocusDrawerProps
> = ({...props}) => {
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
                            <PlaygroundComparisionPromptConfig>
                                <PlaygroundVariantConfig variantId={variantId as string} />
                            </PlaygroundComparisionPromptConfig>
                        ))}
                    </div>
                </section>
            </Drawer>
        </>
    )
}

export default PlaygroundComparisionPromptFocusDrawer
