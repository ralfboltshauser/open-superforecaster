export function jsonResponse(value: unknown, init?: ResponseInit) {
  return Response.json(value, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}
