import {BaseResponse, FuncResponse} from "../Types"

export function isFuncResponse(res: any): res is FuncResponse {
    return res && typeof res.message === "string"
}

export function isBaseResponse(res: any): res is BaseResponse {
    return res && res.data && typeof res.data.message === "string"
}
