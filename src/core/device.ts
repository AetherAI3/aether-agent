// OAuth 2.0 Device Authorization Grant (RFC 8628) client — the default
// `aether auth login` flow. Requests a user_code, the user approves it in the
// portal (aethersystems.net/platform/device), and the CLI polls until the
// server hands back an `aek_` API key. Same flow as `gh auth login`.

import { ApiClient, DEVICE_CODE_PATH, DEVICE_TOKEN_PATH } from "./transport.js";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
}

export type PollResult = "wait" | "slow_down" | "denied" | "expired" | "ready";

interface PollResponse {
  error?: string;
  access_token?: string;
}

/** Pure: map a token-endpoint response to a poll action. */
export function classifyPoll(r: PollResponse): PollResult {
  if (r.access_token) return "ready";
  switch (r.error) {
    case "slow_down":
      return "slow_down";
    case "access_denied":
      return "denied";
    case "expired_token":
      return "expired";
    default:
      return "wait"; // authorization_pending or anything unknown
  }
}

/** Start a device-grant login. Unauthed endpoint. */
export async function requestDeviceCode(api: ApiClient): Promise<DeviceCode> {
  return api.postJson<DeviceCode>(DEVICE_CODE_PATH, { client_id: "aether-cli" });
}

/**
 * Poll the token endpoint until the user approves in the portal. Returns the raw
 * `aek_` token. `sleep` is injected so the loop is testable. Honors `slow_down`
 * (bump interval) and gives up at `expires_in`.
 */
export async function pollForToken(
  api: ApiClient,
  code: DeviceCode,
  sleep: (ms: number) => Promise<void>,
): Promise<string> {
  let interval = code.interval;
  const deadline = Date.now() + code.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    let resp: PollResponse;
    try {
      resp = await api.postJson<PollResponse>(DEVICE_TOKEN_PATH, { device_code: code.device_code });
    } catch (err) {
      // The poll endpoint returns 400 with an `error` body for pending/slow_down/
      // expired; postJson throws HttpError carrying that body.
      resp = (err as { body?: PollResponse }).body ?? { error: "authorization_pending" };
    }
    const action = classifyPoll(resp);
    if (action === "ready") return resp.access_token as string;
    if (action === "denied") throw new Error("authorization denied in the browser");
    if (action === "expired") throw new Error("login timed out — run `aether auth login` again");
    if (action === "slow_down") interval += 5;
  }
  throw new Error("login timed out — run `aether auth login` again");
}
