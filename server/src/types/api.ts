/** Wire shape for any error response returned by the API. */
export interface ApiError {
  error: {
    message: string;
    code: string;
  };
}
