export type User = { id: number; email: string; name: string };
export type Share = { userId: number; email: string; name: string };
export type DocSummary = { id: number; title: string; updatedAt: string; ownerName?: string };
export type DocLists = { owned: DocSummary[]; shared: DocSummary[] };
export type Doc = {
  id: number;
  title: string;
  content: string;
  version: number;
  updatedAt: string;
  owner: { id: number; name: string };
  isOwner: boolean;
  shares: Share[];
};

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : `Request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

// JSON in, JSON out; non-2xx responses throw ApiError carrying the server's { error } message.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const json = typeof init.body === 'string';
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
