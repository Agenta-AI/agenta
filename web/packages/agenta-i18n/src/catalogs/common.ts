import en from "../../locales/en/common.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "common",
    en,
    (language) => import(`../../locales/${language}/common.json`),
)
