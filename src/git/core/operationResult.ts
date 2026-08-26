import type { IdeaGitErrorCode } from "../errors";

export type GitOperationResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: IdeaGitErrorCode;
      message: string;
      recovery?: string;
      cause?: unknown;
    };
