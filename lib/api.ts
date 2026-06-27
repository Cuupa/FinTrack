// Client-side fetch wrapper that attaches the API bearer token (if configured)
// so requests pass the /api gateway in middleware.ts. When NEXT_PUBLIC_API_TOKEN
// is unset it behaves like a plain fetch.

export function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = process.env.NEXT_PUBLIC_API_TOKEN;
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  if (!headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
