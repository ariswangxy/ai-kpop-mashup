import { NextResponse, type NextRequest } from "next/server";

// Proxies beat tracking to the local AI service (separator/server.py), like /api/separate.
const SEPARATOR_URL = process.env.SEPARATOR_URL ?? "http://127.0.0.1:8765";

export async function POST(req: NextRequest) {
  try {
    const res = await fetch(`${SEPARATOR_URL}/beats`, {
      method: "POST",
      headers: { "Content-Type": "audio/wav" },
      body: await req.arrayBuffer(),
      signal: req.signal,
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: "The AI service isn't running." }, { status: 503 });
  }
}
