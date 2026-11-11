import type { NextFunction, Request, RequestHandler, Response } from "express";

export function createSystemAdminHostMiddleware(adminOrigin: string): RequestHandler {
  const adminHostname = new URL(adminOrigin).hostname.toLowerCase();

  return (request: Request, response: Response, next: NextFunction) => {
    if (!(["GET", "HEAD"].includes(request.method)) || request.path !== "/") {
      next();
      return;
    }

    if (request.hostname.toLowerCase() !== adminHostname) {
      next();
      return;
    }

    response.setHeader("Cache-Control", "private, no-store");
    response.redirect(302, "/system-admin");
  };
}
