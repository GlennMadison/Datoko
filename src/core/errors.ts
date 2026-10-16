export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export function publicErrorCode(error: unknown): string {
  return error instanceof AppError ? error.code : "INTERNAL_ERROR";
}
