export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    try {
      const payload = JSON.parse(text) as { error?: unknown; message?: unknown }
      throw new Error(String(payload.error ?? payload.message ?? `Request failed with status ${response.status}.`))
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(text || `Request failed with status ${response.status}.`)
      }
      throw error
    }
  }
  return (await response.json()) as T
}

export function postJson<T>(url: string, body?: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
