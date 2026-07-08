import { classifyRunRequest } from "@open-superforecaster/backend";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const classification = classifyRunRequest({
    prompt: body.prompt,
    requestedMode: body.mode,
    forecastType: body.forecastType,
    workflow: body.workflow,
  });

  return Response.json({ ok: true, classification });
}
