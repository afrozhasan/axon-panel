const CSRF_HEADERS: Record<string, string> = { "x-requested-with": "axon-panel" };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, form = false): Promise<T> {
  const headers: Record<string, string> = { ...CSRF_HEADERS };
  let payload: BodyInit | undefined;

  if (form) {
    payload = body as FormData;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    credentials: "same-origin",
  });

  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 400) };
    }
  }

  if (!response.ok) {
    throw new ApiError(data?.error || data?.message || response.statusText, response.status);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  getText: async (path: string): Promise<string> => {
    const response = await fetch(`/api${path}`, {
      method: "GET",
      headers: { ...CSRF_HEADERS },
      credentials: "same-origin",
    });
    if (!response.ok) throw new ApiError(response.statusText, response.status);
    return response.text();
  },
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  postForm: <T>(path: string, form: FormData) => request<T>("POST", path, form, true),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
