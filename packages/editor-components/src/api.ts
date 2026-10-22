let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body instanceof FormData || body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "x-csrf-token": csrf }),
    },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }
  if (response.headers.get("content-type")?.includes("application/zip"))
    return (await response.blob()) as T;
  return response.json();
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
