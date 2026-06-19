import { NextResponse } from "next/server";

/**
 * Maps the well-known auth errors thrown by getActiveOrg/requirePlatformAdmin
 * to HTTP responses. Returns null if the error isn't an auth error (let the
 * caller handle it as a 500).
 */
export function authErrorResponse(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}
