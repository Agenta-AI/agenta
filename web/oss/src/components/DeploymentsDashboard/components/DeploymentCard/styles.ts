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
            borderColor:
                "0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)",
        },
    },
}))
