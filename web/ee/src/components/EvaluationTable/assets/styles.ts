import {createUseStyles} from "react-jss"

export const useSingleModelEvaluationTableStyles = createUseStyles({
    appVariant: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    inputTestContainer: {
        display: "flex",
        justifyContent: "space-between",
    },
    inputTest: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    inputTestBtn: {
        width: "100%",
        display: "flex",
        justifyContent: "flex-end",
        "& button": {
            marginLeft: 10,
        },
        marginTop: "0.75rem",
    },
    recordInput: {
        marginBottom: 10,
    },
    card: {
        marginBottom: 20,
    },
    statCorrect: {
        "& .ant-statistic-content-value": {
            color: "#3f8600",
        },
    },
    statWrong: {
        "& .ant-statistic-content-value": {
            color: "#cf1322",
        },
    },
    viewModeRow: {
        display: "flex",
        justifyContent: "flex-end",
        margin: "1rem 0",
        position: "sticky",
        top: 36,
        zIndex: 1,
    },
    sideBar: {
        marginTop: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "2rem",
        border: "1px solid #d9d9d9",
        borderRadius: 6,
        padding: "1rem",
        alignSelf: "flex-start",
        "&>h4.ant-typography": {
            margin: 0,
        },
        flex: 0.35,
        minWidth: 240,
        maxWidth: 500,
    },
})

export const useABTestingEvaluationTableStyles = createUseStyles({
    appVariant: {
        padding: 4,
        borderRadius: 5,
    },
    inputTestContainer: {
        display: "flex",
        justifyContent: "space-between",
    },
    inputTest: {
        backgroundColor: "rgb(201 255 216)",
        color: "rgb(0 0 0)",
        padding: 4,
        borderRadius: 5,
    },
    inputTestBtn: {
        width: "100%",
        display: "flex",
        justifyContent: "flex-end",
        "& button": {
            marginLeft: 10,
        },
        marginTop: "0.75rem",
    },
    recordInput: {
        marginBottom: 10,
    },
    card: {
        marginBottom: 20,
    },
    statCorrect: {
        "& .ant-statistic-content-value": {
            color: "#3f8600",
        },
    },
    stat: {
        "& .ant-statistic-content-value": {
            color: "#1677ff",
        },
    },
    statWrong: {
        "& .ant-statistic-content-value": {
            color: "#cf1322",
        },
    },
    viewModeRow: {
        display: "flex",
        justifyContent: "flex-end",
        margin: "1rem 0",
        position: "sticky",
        top: 36,
        zIndex: 1,
    },
    sideBar: {
        marginTop: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "2rem",
        border: "1px solid #d9d9d9",
        borderRadius: 6,
        padding: "1rem",
        alignSelf: "flex-start",
        "&>h4.ant-typography": {
            margin: 0,
        },
        flex: 0.35,
        minWidth: 240,
        maxWidth: 500,
    },
})
