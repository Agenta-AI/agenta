import en from "../../locales/en/sessions.memberPicker.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "sessions.memberPicker",
    en,
    (language) => import(`../../locales/${language}/sessions.memberPicker.json`),
)
