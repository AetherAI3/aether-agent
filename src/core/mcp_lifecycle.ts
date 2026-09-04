/**
 * One bounded lifecycle for MCP broker calls and local-server probes.
 *
 * The supervisor deliberately races even providers which ignore AbortSignal.
 * Abort remains the resource-release instruction for compliant transports;
 * the settled guard prevents a late provider completion from re-entering the
 * terminal after the operator has cancelled or the watchdog has fired.
 */

export const DEFAULT_MCP_OPERATION_TIMEOUT_MS = 10_000;
export const MAX_MCP_OPERATION_TIMEOUT_MS = 180_000;

function duration(timeoutMs: number): string {
  return timeoutMs < 1_000
    ? `${timeoutMs}ms`
    : `${Math.round(timeoutMs / 1_000)}s`;
}

export class McpOperationTimeoutError extends Error {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `MCP ${operation} stalled for ${duration(timeoutMs)}; the request was cancelled, ` +
        "your selection and non-secret input are preserved and safe to retry; " +
        "run `aether mcp doctor` for diagnostics",
    );
    this.name = "McpOperationTimeoutError";
  }
}

export class McpOperationCancelledError extends Error {
  constructor(public readonly operation: string) {
    super(
      `MCP ${operation} was cancelled; your selection and non-secret input are preserved ` +
        "and the terminal is ready",
    );
    this.name = "McpOperationCancelledError";
  }
}

export interface McpOperationOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Register a terminal cancellation callback. The returned function must detach it. */
  subscribeCancel?: (cancel: () => void) => () => void;
}

interface ActiveOperation {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  unsubscribeCancel: (() => void) | null;
  removeExternalAbort: (() => void) | null;
  cancel: (reason: "cancelled" | "disposed" | "timeout") => void;
}

export interface McpLifecycleResources {
  operations: number;
  timers: number;
  cancellationSubscriptions: number;
}

function normalizedTimeout(value: number | undefined): number {
  if (value == null) return DEFAULT_MCP_OPERATION_TIMEOUT_MS;
  if (!Number.isFinite(value)) return DEFAULT_MCP_OPERATION_TIMEOUT_MS;
  return Math.max(1, Math.min(Math.trunc(value), MAX_MCP_OPERATION_TIMEOUT_MS));
}

export class McpOperationSupervisor {
  private readonly active = new Set<ActiveOperation>();
  private disposed = false;

  run<T>(
    operation: string,
    work: (signal: AbortSignal) => Promise<T>,
    options: McpOperationOptions = {},
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new McpOperationCancelledError(operation));
    const timeoutMs = normalizedTimeout(options.timeoutMs);

    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      let settled = false;
      const entry: ActiveOperation = {
        controller,
        timer: null,
        unsubscribeCancel: null,
        removeExternalAbort: null,
        cancel: () => {},
      };

      const cleanup = (): void => {
        if (entry.timer) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }
        const unsubscribeCancel = entry.unsubscribeCancel;
        entry.unsubscribeCancel = null;
        const removeExternalAbort = entry.removeExternalAbort;
        entry.removeExternalAbort = null;
        try {
          unsubscribeCancel?.();
        } catch {
          // Teardown must finish even when an injected terminal adapter has a
          // defective disposer. The primary operation outcome stays honest.
        }
        try {
          removeExternalAbort?.();
        } catch {
          // AbortSignal is native in production; keep injected test/provider
          // cleanup faults from stranding the operation in the active set.
        }
        this.active.delete(entry);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const succeed = (value: T): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      entry.cancel = (reason): void => {
        if (settled) return;
        controller.abort();
        fail(
          reason === "timeout"
            ? new McpOperationTimeoutError(operation, timeoutMs)
            : new McpOperationCancelledError(operation),
        );
      };

      this.active.add(entry);
      entry.timer = setTimeout(() => entry.cancel("timeout"), timeoutMs);

      if (options.signal) {
        const external = options.signal;
        const onAbort = (): void => entry.cancel("cancelled");
        if (external.aborted) {
          entry.cancel("cancelled");
          return;
        }
        external.addEventListener("abort", onAbort, { once: true });
        entry.removeExternalAbort = () => external.removeEventListener("abort", onAbort);
      }

      if (options.subscribeCancel) {
        try {
          entry.unsubscribeCancel = options.subscribeCancel(() => entry.cancel("cancelled"));
        } catch (error) {
          fail(error);
          return;
        }
        if (settled) {
          entry.unsubscribeCancel?.();
          entry.unsubscribeCancel = null;
          return;
        }
      }

      // Promise.resolve also turns a synchronous provider throw into the same
      // single terminal outcome as an asynchronous rejection.
      Promise.resolve()
        .then(() => settled ? undefined as T : work(controller.signal))
        .then(succeed, (error: unknown) => {
          if (settled) return;
          if (controller.signal.aborted) fail(new McpOperationCancelledError(operation));
          else fail(error);
        });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.active]) entry.cancel("disposed");
  }

  resources(): McpLifecycleResources {
    let timers = 0;
    let cancellationSubscriptions = 0;
    for (const entry of this.active) {
      if (entry.timer) timers++;
      if (entry.unsubscribeCancel) cancellationSubscriptions++;
    }
    return { operations: this.active.size, timers, cancellationSubscriptions };
  }
}

export interface LocalMcpProbeResponse {
  status: number;
  body?: { cancel(): Promise<unknown> } | null;
}

export type LocalMcpFetch = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
    redirect: "manual";
    cache: "no-store";
    signal: AbortSignal;
  },
) => Promise<LocalMcpProbeResponse>;

export interface LocalMcpReachability {
  reachable: true;
  verified: false;
  httpStatus: number;
  serviceHealthy: boolean;
  detail: string;
}

/**
 * Probe only reachability. This intentionally does not send the stored auth
 * token and does not claim an MCP handshake or tool verification. GET works
 * for SSE; 401/403/405 still prove that an HTTP MCP endpoint answered.
 */
export async function probeLocalMcpServer(
  url: string,
  signal: AbortSignal,
  fetcher: LocalMcpFetch = fetch as unknown as LocalMcpFetch,
): Promise<LocalMcpReachability> {
  const response = await fetcher(url, {
    method: "GET",
    headers: { Accept: "text/event-stream, application/json" },
    redirect: "manual",
    cache: "no-store",
    signal,
  });
  // We need only response headers for a reachability result. Cancel an SSE or
  // response body immediately so the diagnostic never owns a streaming reader.
  try {
    await response.body?.cancel();
  } catch {
    // Aborted/native fetch bodies may reject cancellation after the socket is
    // already released. Reachability is still determined by the headers.
  }
  const serviceHealthy = response.status < 500;
  const detail = serviceHealthy
    ? `reachable (HTTP ${response.status}); MCP protocol and tools not verified`
    : `reachable but service returned HTTP ${response.status}; MCP protocol and tools not verified`;
  return {
    reachable: true,
    verified: false,
    httpStatus: response.status,
    serviceHealthy,
    detail,
  };
}
