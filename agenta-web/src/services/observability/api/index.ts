import {delay} from "@/lib/helpers/utils"
import data from "@/lib/test_trace.json"
import {AgentaRootsResponse} from "../types"

//Prefix convention:
//  - fetch: GET single entity from server
//  - fetchAll: GET all entities from server
//  - create: POST data to server
//  - update: PUT data to server
//  - delete: DELETE data from server

export const fetchAllTraces = async () => {
    await delay(1000)
    return data as AgentaRootsResponse
}
