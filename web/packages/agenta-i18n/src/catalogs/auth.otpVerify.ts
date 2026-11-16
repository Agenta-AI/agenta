import en from "../../locales/en/auth.otpVerify.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "auth.otpVerify",
    en,
    (language) => import(`../../locales/${language}/auth.otpVerify.json`),
)
