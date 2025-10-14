import {useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"
import {createUseStyles} from "react-jss"

import {NewVariantParametersView} from "@/oss/components/VariantsComponents/Drawers/VariantDrawer/assets/Parameters"
import {filterVariantParameters} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {JSSTheme, Variant} from "@/oss/lib/Types"
import {DeploymentRevisionConfig} from "@/oss/lib/types_ee"
import {currentAppAtom} from "@/oss/state/app"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
    },
    subTitle: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
    resultTag: {
        minWidth: 150,
        display: "flex",
        borderRadius: theme.borderRadiusSM,
        border: `1px solid ${theme.colorBorder}`,
        textAlign: "center",
        "& > div:nth-child(1)": {
            backgroundColor: "rgba(0, 0, 0, 0.02)",
            lineHeight: theme.lineHeight,
            flex: 1,
            minWidth: 50,
            borderRight: `1px solid ${theme.colorBorder}`,
            padding: "0 7px",
        },
        "& > div:nth-child(2)": {
            padding: "0 7px",
        },
    },
    promptTextField: {
        padding: theme.paddingXS,
        backgroundColor: theme.colorBgContainerDisabled,
        borderRadius: theme.borderRadius,
    },
    noParams: {
        color: theme.colorTextDescription,
        fontWeight: theme.fontWeightMedium,
        textAlign: "center",
        marginTop: 48,
    },
}))

interface HistoryConfigProps {
    depRevisionConfig: DeploymentRevisionConfig
    variant: Variant
}

const HistoryConfig = ({depRevisionConfig, variant: propsVariant}: HistoryConfigProps) => {
    const classes = useStyles()

    const currentApp = useAtomValue(currentAppAtom)
    // @ts-ignore
    const {data, isLoading} = useVariants(currentApp, [propsVariant])
    const variant = useMemo(
        // @ts-ignore
        () => data?.variants.find((v) => v.id === propsVariant.id),
        [data?.variants, propsVariant.id],
    )

    return (
        <div className="flex flex-col gap-4 grow h-full">
            <Typography.Text className={classes.title}>Configuration</Typography.Text>

            {Object.keys(depRevisionConfig.parameters).length ? (
                <div className="flex flex-col gap-6 grow">
                    <div className="flex flex-col gap-2 grow">
                        {!isLoading && !!variant ? (
                            <NewVariantParametersView
                                selectedVariant={variant}
                                parameters={depRevisionConfig.parameters}
                            />
                        ) : null}
                    </div>

                    {depRevisionConfig.parameters &&
                        Object.entries(
                            filterVariantParameters({
                                record: depRevisionConfig.parameters,
                                key: "prompt",
                            }),
                        ).map(([key, value], index) => (
                            <div className="flex flex-col gap-2" key={index}>
                                <Typography.Text className={classes.subTitle}>
                                    {key}
                                </Typography.Text>
                                <div className={classes.promptTextField}>
                                    {JSON.stringify(value)}
                                </div>
                            </div>
                        ))}
                </div>
            ) : (
                <Typography.Text className={classes.noParams}>No Parameters</Typography.Text>
            )}
        </div>
    )
}

export default HistoryConfig
