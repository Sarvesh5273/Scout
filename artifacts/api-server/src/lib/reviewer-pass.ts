import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { logger } from "./logger";

/**
 * Reviewer access. The owner stores a code in the REVIEWER_PASS secret and gives reviewers the link
 * `https://<site>/?pass=<code>`. The web app keeps the code in localStorage and sends it with every API
 * request as `X-Scout-Pass`. Reviewer searches skip the shared hourly cap, run ahead of other queued work and
 * may use the budget held back in REVIEWER_RESERVE. Remove the secret to switch all of this off.
 */
const HEADER = "x-scout-pass";
const MIN_LENGTH = 10;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

const expected: Buffer | null = (() => {
  const pass = process.env.REVIEWER_PASS?.trim();
  if (!pass) return null;
  if (pass.length < MIN_LENGTH) {
    logger.warn({ minLength: MIN_LENGTH }, "REVIEWER_PASS is too short, so reviewer access is off");
    return null;
  }
  return digest(pass);
})();

export function reviewerPassConfigured(): boolean {
  return expected !== null;
}

export function hasReviewerPass(req: Request): boolean {
  const given = req.get(HEADER)?.trim();
  if (!expected || !given) return false;
  // Fixed-length digests keep the comparison constant-time whatever the input length.
  return timingSafeEqual(digest(given), expected);
}
