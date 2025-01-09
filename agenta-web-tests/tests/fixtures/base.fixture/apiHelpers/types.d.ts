export interface ApiHandlerOptions<T> {
  route: string | RegExp;
  method?: string;
  validateStatus?: boolean;
  responseHandler?: (data: T) => Promise<void> | void;
}

export interface ApiHelpers {
  waitForApiResponse: <T>(options: ApiHandlerOptions<T>) => Promise<T>;
}
