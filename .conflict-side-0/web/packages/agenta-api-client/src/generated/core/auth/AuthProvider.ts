import type { EndpointMetadata } from "../fetcher/EndpointMetadata.js";
import type { AuthRequest } from "./AuthRequest.js";

export interface AuthProvider {
    getAuthRequest(arg?: { endpointMetadata?: EndpointMetadata }): Promise<AuthRequest>;
}
