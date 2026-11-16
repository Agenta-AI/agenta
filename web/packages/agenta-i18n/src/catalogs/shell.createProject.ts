import en from "../../locales/en/shell.createProject.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "shell.createProject",
    en,
    (language) => import(`../../locales/${language}/shell.createProject.json`),
)
