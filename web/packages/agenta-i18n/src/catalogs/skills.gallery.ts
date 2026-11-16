import en from "../../locales/en/skills.gallery.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "skills.gallery",
    en,
    (language) => import(`../../locales/${language}/skills.gallery.json`),
)
