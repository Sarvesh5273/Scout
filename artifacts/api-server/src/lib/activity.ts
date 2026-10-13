import type { NextFunction, Request, Response } from "express";

let lastRequestAt = Date.now();

/** Records API traffic so background work can tell when nobody is using Scout. */
export function trackActivity(_req: Request, _res: Response, next: NextFunction): void {
  lastRequestAt = Date.now();
  next();
}

export function msSinceLastRequest(): number {
  return Date.now() - lastRequestAt;
}
