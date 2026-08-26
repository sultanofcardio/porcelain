import type { PorcelainErrorCode } from "../errors";

export type GitOperationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: PorcelainErrorCode;
      message: string;
      recovery?: string;
      cause?: unknown;
    };
