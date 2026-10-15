class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly recordId?: string
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const DEFAULT_API_REQUEST_TIMEOUT_MS = 12_000;

export class ApiRequestTimeoutError extends Error {
  readonly code = "REQUEST_TIMEOUT";

  constructor(readonly timeoutMs: number) {
    super("Request timed out.");
    this.name = "ApiRequestTimeoutError";
  }
}

export const TIMED_OUT_WRITE_CONFIRM_DELAY_MS = 400;
export const TIMED_OUT_WRITE_CONFIRM_TIMEOUT_MS = 3_000;

export async function confirmTimedOutWrite<T>({
  confirm,
  delayMs = TIMED_OUT_WRITE_CONFIRM_DELAY_MS,
  matches,
  write
}: {
  confirm: () => Promise<T>;
  delayMs?: number;
  matches: (value: T) => boolean;
  write: () => Promise<T>;
}): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!(error instanceof ApiRequestTimeoutError)) throw error;

    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, delayMs);
      });
    }

    try {
      const current = await confirm();
      if (matches(current)) return current;
    } catch {
      // Preserve the original timeout when the confirmation read also fails.
    }

    throw error;
  }
}

export async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch((error) => {
    if (response.ok || (error instanceof Error && error.name === "AbortError")) {
      throw error;
    }

    return {};
  });

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Request failed";
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("htools:admin-unauthorized"));
    }
    const code =
      typeof payload === "object" &&
      payload !== null &&
      "code" in payload &&
      typeof payload.code === "string"
        ? payload.code
        : undefined;
    const recordId =
      typeof payload === "object" &&
      payload !== null &&
      "recordId" in payload &&
      typeof payload.recordId === "string"
        ? payload.recordId
        : undefined;
    throw new ApiClientError(message, response.status, code, recordId);
  }

  return payload as T;
}

export async function requestJsonWithTimeout<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_API_REQUEST_TIMEOUT_MS;
  const requestController = new AbortController();
  const externalSignal = init.signal;
  let abortSource: "external" | "timeout" | null = null;

  function abortRequest(source: "external" | "timeout") {
    if (abortSource || requestController.signal.aborted) return;
    abortSource = source;
    requestController.abort();
  }

  function handleExternalAbort() {
    abortRequest("external");
  }

  if (externalSignal?.aborted) {
    handleExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", handleExternalAbort, {
      once: true
    });
  }

  const timeout = globalThis.setTimeout(
    () => abortRequest("timeout"),
    timeoutMs
  );

  try {
    const response = await fetchImpl(input, {
      ...init,
      signal: requestController.signal
    });
    return await readJson<T>(response);
  } catch (error) {
    if (abortSource === "timeout") {
      throw new ApiRequestTimeoutError(timeoutMs);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}
