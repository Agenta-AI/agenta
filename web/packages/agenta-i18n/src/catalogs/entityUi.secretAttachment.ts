import en from "../../locales/en/entityUi.secretAttachment.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.secretAttachment",
    en,
    (language) => import(`../../locales/${language}/entityUi.secretAttachment.json`),
)
