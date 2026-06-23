/** Base class for errors that should be translated directly into an HTTP response by `errorHandler`. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, message, "NOT_FOUND");
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "You do not have access to this resource") {
    super(403, message, "FORBIDDEN");
  }
}

export class ValidationError extends HttpError {
  constructor(message = "Invalid input") {
    super(400, message, "VALIDATION_ERROR");
  }
}
