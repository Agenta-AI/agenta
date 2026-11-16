import en from "../../locales/en/sessions.mobileList.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.mobileList",
    en,
    (language) => import(`../../locales/${language}/sessions.mobileList.json`),
)
