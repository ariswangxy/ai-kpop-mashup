import { NextResponse, type NextRequest } from "next/server";

// Proxies to the local Demucs service (separator/server.py) so the browser never talks to it directly.
const SEPARATOR_URL = process.env.SEPARATOR_URL ?? "http://127.0.0.1:8765";

const OFFLINE = { ok: false, error: "The AI separator isn't running. Start it with `npm run separator`." };

export async function GET() {
  try {
    const res = await fetch(`${SEPARATOR_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    // Reported as data, not an HTTP error: being offline is a normal state for the health check.
    return NextResponse.json(OFFLINE);
  }
}

export async function POST(req: NextRequest) {
  const keep = req.nextUrl.searchParams.get("keep");
  if (keep !== "vocals" && keep !== "instrumental") {
    return NextResponse.json({ error: "keep must be 'vocals' or 'instrumental'" }, { status: 400 });
  }
  let res: Response;
  try {
    res = await fetch(`${SEPARATOR_URL}/separate?keep=${keep}`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: await req.arrayBuffer(),
      signal: req.signal,
    });
  } catch {
    return NextResponse.json(OFFLINE, { status: 503 });
  }
  return new NextResponse(res.body, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream" },
  });
}
