import type { Request } from "express";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Scout has no accounts. Each browser generates a random id, keeps it in localStorage and sends it as
 * `Authorization: Bearer <id>`. A header is used instead of a cookie because the Replit preview runs the
 * app in a cross-site iframe, where browsers drop third-party cookies.
 */
export function getClientId(req: Request): string | null {
  const header = req.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const id = match?.[1];
  return id && CLIENT_ID_PATTERN.test(id) ? id : null;
}
