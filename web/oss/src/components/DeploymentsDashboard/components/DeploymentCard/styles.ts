import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useDeploymentCardStyles = createUseStyles((theme: JSSTheme) => ({
    deploymentCard: {
        cursor: "pointer",
        width: "100%",
        transition: "all 0.25s ease-in",
        position: "relative",
        "& .ant-card-body": {
            padding: theme.paddingSM,
            display: "flex",
            flexDirection: "column",
            gap: theme.paddingXS,
            "&:before": {
                display: "none",
            },
            "& > span.ant-typography:first-of-type": {
                textTransform: "capitalize",
            },
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
            borderColor: "var(--hover-border-color)",
        },
    },
}))
