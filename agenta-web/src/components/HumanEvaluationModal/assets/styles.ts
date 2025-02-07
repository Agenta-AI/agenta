import {createUseStyles} from "react-jss"

import type {JSSTheme, StyleProps} from "@/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    evaluationContainer: {
        border: "1px solid lightgrey",
        padding: "20px",
        borderRadius: "14px",
        marginBottom: 50,
    },
    evaluationImg: ({themeMode}: StyleProps) => ({
        width: 24,
        height: 24,
        marginRight: "8px",
        filter: themeMode === "dark" ? "invert(1)" : "none",
    }),
    createCustomEvalBtn: {
        color: "#fff  !important",
        backgroundColor: "#0fbf0f",
        marginRight: "20px",
        borderColor: "#0fbf0f !important",
    },
    evaluationType: {
        display: "flex",
        alignItems: "center",
    },
    dropdownStyles: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
    },
    dropdownBtn: {
        marginRight: 10,
        width: "100%",
    },
    optionSelected: {
        border: "1px solid #1668dc",
        "& .ant-select-selection-item": {
            color: "#1668dc !important",
        },
    },
    radioGroup: {
        width: "100%",
        "& .ant-radio-button-wrapper": {
            marginBottom: "0.5rem",
            borderRadius: theme.borderRadius,
            borderLeft: `1px solid ${theme.colorBorder}`,
            "&::before": {
                display: "none",
            },
        },
        "& .ant-radio-button-wrapper-checked ": {
            borderLeft: `1px solid ${theme.colorPrimary}`,
        },
    },
    radioBtn: {
        display: "block",
        marginBottom: "10px",
    },
    selectGroup: {
        width: "100%",
        display: "block",
        "& .ant-select-selector": {
            borderRadius: 0,
        },
        "& .ant-select-selection-item": {
            marginLeft: 34,
        },
    },
    customCodeSelectContainer: {
        position: "relative",
    },
    customCodeIcon: {
        position: "absolute",
        left: 16,
        top: 4.5,
        pointerEvents: "none",
    },
    thresholdStyles: {
        paddingLeft: 10,
        paddingRight: 10,
    },
    variantDropdown: {
        marginRight: 10,
        width: "100%",
    },
    newCodeEval: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#1668dc",
    },
    newCodeEvalList: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    dropdownItemLabels: {
        fontSize: theme.fontSizeSM,
        lineHeight: theme.lineHeightSM,
        color: theme.colorTextDescription,
    },
}))
