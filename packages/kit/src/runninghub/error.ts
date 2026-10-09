export type RunningHubErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_INPUT"
  | "REQUEST_ABORTED"
  | "REQUEST_FAILED"
  | "INVALID_RESPONSE"
  | "UPSTREAM_REJECTED"
  | "TASK_FAILED"
  | "TASK_TIMEOUT"
  | "UNKNOWN_TASK_STATUS"
  | "MISSING_OUTPUT";

export interface RunningHubErrorOptions {
  stage: "configuration" | "submit" | "poll" | "result";
  status?: number;
  retryable?: boolean;
  cause?: unknown;
}

export class RunningHubError extends Error {
  readonly code: RunningHubErrorCode;
  readonly stage: RunningHubErrorOptions["stage"];
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(code: RunningHubErrorCode, message: string, options: RunningHubErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "RunningHubError";
    this.code = code;
    this.stage = options.stage;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

export function isRunningHubError(value: unknown): value is RunningHubError {
  return value instanceof RunningHubError;
}
