// GitHub Connect client — links the user's real GitHub account to their Aether
// account so backend (VPS2) coding agents can clone/branch/PR on their repos.
//
// Web-canonical, same shape as `auth login`'s device flow: the CLI asks the
// backend for an install_url, the user approves the GitHub App in the browser,
// and the CLI polls `/account/github/status` until the install lands. We never
// see or store a GitHub token — the backend mints short-lived install tokens
// just-in-time. The CLI only ever holds the user's `aek_` Aether token.

import { ApiClient, GITHUB_CONNECT_PATH, GITHUB_STATUS_PATH, GITHUB_DISCONNECT_PATH } from "./transport.js";

export interface GithubStatus {
  connected: boolean;
  /** Org/user the App was installed on (display only). */
  login?: string;
  account_type?: string;
  /** 'all' | 'selected' — which repos the user granted. */
  repo_selection?: string;
}

interface ConnectResponse {
  install_url: string;
}

/** Current link state. Bearer-authed. */
export async function getGithubStatus(api: ApiClient): Promise<GithubStatus> {
  return api.getJson<GithubStatus>(GITHUB_STATUS_PATH);
}

/** Begin a connect: backend returns the signed GitHub App install URL. */
export async function startGithubConnect(api: ApiClient): Promise<string> {
  const r = await api.getJson<ConnectResponse>(GITHUB_CONNECT_PATH);
  if (!r.install_url) throw new Error("backend returned no install_url");
  return r.install_url;
}

/** Remove the link: backend uninstalls the App and revokes the row. */
export async function disconnectGithub(api: ApiClient): Promise<void> {
  await api.postJson<{ disconnected: boolean }>(GITHUB_DISCONNECT_PATH, {});
}

export interface PollOpts {
  /** Seconds between status polls. */
  intervalSec?: number;
  /** Give up after this many seconds. */
  timeoutSec?: number;
}

/**
 * Poll `/account/github/status` until `connected` flips true. `sleep` is
 * injected so the loop is testable. A transient status error is swallowed and
 * retried (the user may still be mid-approval); we only fail on timeout.
 */
export async function pollUntilConnected(
  api: ApiClient,
  sleep: (ms: number) => Promise<void>,
  opts: PollOpts = {},
): Promise<GithubStatus> {
  const intervalMs = (opts.intervalSec ?? 3) * 1000;
  const deadline = Date.now() + (opts.timeoutSec ?? 300) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let status: GithubStatus;
    try {
      status = await getGithubStatus(api);
    } catch {
      continue; // transient — keep waiting until the deadline
    }
    if (status.connected) return status;
  }
  throw new Error("timed out waiting for GitHub authorization — run `aether github connect` again");
}
