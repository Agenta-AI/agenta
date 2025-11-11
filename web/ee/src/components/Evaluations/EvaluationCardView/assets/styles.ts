import {createUseStyles} from "react-jss"

export const VARIANT_COLORS = [
    "#297F87", // "#722ed1",
    "#F6D167", //"#13c2c2",
    "#4caf50",
]

export const useStyles = createUseStyles({
    root: {
        display: "flex",
        gap: "1rem",
        outline: "none",
    },
    evaluation: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "1rem",
        "& .ant-divider": {
            margin: "2rem 0 1.5rem 0",
        },
        "& h5.ant-typography": {
            margin: 0,
            marginBottom: "1rem",
        },
        gap: "1rem",
    },
    heading: {
        width: "100%",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "0.75rem",
        "& .ant-typography": {
            margin: 0,
            fontWeight: 400,
        },
    },
    headingDivider: {
        position: "relative",
    },
    helpIcon: {
        position: "absolute",
        right: 0,
        top: 42,
        fontSize: 16,
    },
    instructions: {
        paddingInlineStart: 0,
        "& code": {
            backgroundColor: "rgba(0, 0, 0, 0.05)",
            padding: "0.1rem 0.3rem",
            borderRadius: 3,
        },
        "& li": {
            marginBottom: "0.5rem",
        },
    },
    note: {
        marginTop: "1.25rem",
        marginBottom: "-1rem",
        whiteSpace: "pre-line",
        display: "flex",
        alignItems: "flex-start",

        "& .anticon": {
            marginTop: 4,
        },
    },
    chatInputsCon: {
        marginTop: "0.5rem",
    },
    correctAnswerCon: {
        marginBottom: "0.5rem",
    },
    toolBar: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        justifyContent: "flex-end",
        "& .anticon": {
            fontSize: 18,
            cursor: "pointer",
        },
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
    centeredItem: {
        display: "grid",
        placeItems: "center",
        width: "100%",
    },
})
