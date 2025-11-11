import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

export const useStyles = createUseStyles((theme: JSSTheme) => ({
    errorMessage: {
        color: theme.colorError,
        fontWeight: theme.fontWeightMedium,
    },
    errorSub: {
        color: theme.colorTextSecondary,
    },
    inputOTP: {
        "& > .ant-row .ant-col .ant-form-item-control-input .ant-form-item-control-input-content .ant-otp .ant-input":
            {
                border: "1px solid",
                borderColor: theme.colorErrorBorder,
            },
    },
    otpFormContainer: {
        "& .ant-otp": {
            width: "100%",
        },
    },
    textDisabled: {
        color: theme.colorTextDisabled,
    },
}))
