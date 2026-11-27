// Research Suite's public keyset for Moodle. Basic launches don't need a tool
// key; one will be published here when grade services are added.
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ keys: [] }, { headers: { "cache-control": "public, max-age=300" } });
}
