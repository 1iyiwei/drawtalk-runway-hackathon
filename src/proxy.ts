import { NextResponse, type NextRequest } from "next/server";

// Password gate for sharing the demo (e.g. through an ngrok tunnel): when
// DEMO_PASSWORD is set, every page and API route requires HTTP Basic Auth
// (username DEMO_USER, default "judge"). Unset locally, it does nothing.
export function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.DEMO_USER || "judge";

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      if (u === user && rest.join(":") === password) return NextResponse.next();
    } catch {
      // malformed header: fall through to 401
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DrawTalkRunway demo", charset="UTF-8"' },
  });
}

export const config = {
  // Everything except Next's static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
