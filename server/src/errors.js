export class HttpError extends Error {
  constructor(status, message, code = "error") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function isHttpError(error) {
  return error instanceof HttpError;
}
