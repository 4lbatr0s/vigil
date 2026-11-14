/** Typed application error. Every failure that crosses the API boundary is one of these. */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
