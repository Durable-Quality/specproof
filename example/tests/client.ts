// Minimal HTTP client the example tests are written against.
//
// The example suite is fixture data for SpecProof's analyzer — it is excluded
// from this repo's typecheck, lint, and vitest runs and never executes here.
// It exists so the tests read like a real integration suite.

const BASE_URL = process.env.API_URL ?? "http://localhost:4010";

export interface ApiResponse {
  status: number;
  body: Record<string, unknown> & { id?: string; token?: string };
}

interface RequestOptions {
  /** Set to false to send the request without a bearer token */
  auth?: boolean;
}

let sessionToken: string | null = null;

export function authenticate(token: string | null) {
  sessionToken = token;
}

async function request(
  method: string,
  path: string,
  payload?: unknown,
  options: RequestOptions = {},
): Promise<ApiResponse> {
  const withAuth = options.auth !== false && sessionToken !== null;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(withAuth ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

export const api = {
  get: (path: string, options?: RequestOptions) =>
    request("GET", path, undefined, options),
  post: (path: string, payload?: unknown, options?: RequestOptions) =>
    request("POST", path, payload, options),
  patch: (path: string, payload?: unknown, options?: RequestOptions) =>
    request("PATCH", path, payload, options),
  delete: (path: string, options?: RequestOptions) =>
    request("DELETE", path, undefined, options),
};
