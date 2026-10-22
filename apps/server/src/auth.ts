import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Session } from "../../../generated/prisma/client";
import { db } from "./db";
const digest = (s: string) => createHash("sha256").update(s).digest();
export const tokenHash = (s: string) => digest(s).toString("hex");
export const secureEqual = (a: string, b: string) =>
  timingSafeEqual(digest(a), digest(b));
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
declare module "fastify" {
  interface FastifyRequest {
    auth: Session | null;
  }
}
export function authConfig() {
  const token = process.env.ADMIN_EDITOR_TOKEN,
    origin = process.env.APP_ORIGIN ?? "http://localhost:3100";
  if (!token || token.length < 40 || /REPLACE|placeholder/i.test(token))
    throw new Error("ADMIN_EDITOR_TOKEN must contain at least 32 random bytes");
  const parsed = new URL(origin);
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(parsed.hostname)
  )
    throw new Error("HTTP is allowed only on loopback");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    throw new Error("Production requires HTTPS APP_ORIGIN");
  return { token, origin, secure: parsed.protocol === "https:" };
}
export function cookieName(role: string) {
  return `${authConfig().secure ? "__Host-" : ""}${role}_sid`;
}
export async function createSession(
  role: "editor" | "player",
  reply: FastifyReply,
  uid?: string,
) {
  const raw = randomBytes(32).toString("base64url"),
    csrf = randomBytes(32).toString("base64url"),
    ttl =
      role === "editor"
        ? Number(process.env.EDITOR_SESSION_TTL_SECONDS ?? 28800)
        : 30 * 86400;
  await db.session.create({
    data: {
      hash: tokenHash(raw),
      role,
      uid,
      csrf,
      epoch: role === "editor" ? tokenHash(authConfig().token) : "player-v1",
      expiresAt: new Date(Date.now() + ttl * 1000),
      lastSeen: new Date(),
    },
  });
  reply.setCookie(cookieName(role), raw, {
    httpOnly: true,
    secure: authConfig().secure,
    sameSite: "strict",
    path: "/",
    maxAge: ttl,
  });
  return csrf;
}
export async function readSession(
  req: FastifyRequest,
  role: "editor" | "player",
) {
  const raw = req.cookies[cookieName(role)];
  if (!raw) return null;
  const session = await db.session.findUnique({
    where: { hash: tokenHash(raw) },
  });
  if (
    !session ||
    session.role !== role ||
    session.expiresAt.getTime() < Date.now() ||
    (role === "editor" &&
      (session.epoch !== tokenHash(authConfig().token) ||
        session.lastSeen.getTime() +
          Number(process.env.EDITOR_SESSION_IDLE_SECONDS ?? 1800) * 1000 <
          Date.now()))
  )
    return null;
  if (Date.now() - session.lastSeen.getTime() > 60000)
    await db.session.update({
      where: { hash: session.hash },
      data: { lastSeen: new Date() },
    });
  return session;
}
export function requireOrigin(req: FastifyRequest) {
  if (
    req.headers.origin !== authConfig().origin ||
    req.headers["sec-fetch-site"] === "cross-site"
  )
    throw new HttpError(403, "Invalid request origin");
}
export async function requireSession(
  req: FastifyRequest,
  role: "editor" | "player",
  csrf = true,
) {
  const session = await readSession(req, role);
  if (!session) throw new HttpError(401, "Authentication required");
  req.auth = session;
  if (csrf && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    requireOrigin(req);
    if (
      typeof req.headers["x-csrf-token"] !== "string" ||
      !secureEqual(req.headers["x-csrf-token"], session.csrf)
    )
      throw new HttpError(403, "Invalid CSRF token");
  }
  return session;
}
export async function audit(
  req: FastifyRequest,
  action: string,
  resource: string,
  digest?: string,
  status = "ok",
) {
  await db.audit.create({
    data: { action, resource, requestId: req.id, digest, status },
  });
}
export function installAuth(app: FastifyInstance) {
  authConfig();
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "same-origin");
    const path = req.url.split("?")[0];
    if (path.startsWith("/api/editor/") && path !== "/api/editor/auth/login")
      await requireSession(req, "editor");
    if (path.startsWith("/editor") && path !== "/editor/login") {
      const session = await readSession(req, "editor");
      if (!session) return reply.redirect("/editor/login");
      req.auth = session;
    }
    if (path.startsWith("/api/users/me") || path.startsWith("/api/rooms"))
      await requireSession(req, "player");
    if (path.startsWith("/api/editor") || path.startsWith("/editor"))
      reply.header("Cache-Control", "no-store");
  });
  app.post(
    "/api/editor/auth/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        body: {
          type: "object",
          required: ["token"],
          additionalProperties: false,
          properties: { token: { type: "string", maxLength: 512 } },
        },
      },
    },
    async (req, reply) => {
      requireOrigin(req);
      const body = req.body as { token: string };
      if (!secureEqual(body.token, authConfig().token)) {
        await audit(req, "login", "editor", undefined, "denied");
        throw new HttpError(401, "Invalid credentials");
      }
      const old = req.cookies[cookieName("editor")];
      if (old) await db.session.deleteMany({ where: { hash: tokenHash(old) } });
      const csrf = await createSession("editor", reply);
      await audit(req, "login", "editor");
      return { csrf };
    },
  );
  app.get("/api/editor/session", async (req) => ({
    csrf: req.auth!.csrf,
    role: "editor",
  }));
  app.post("/api/editor/auth/logout", async (req, reply) => {
    await db.session.delete({ where: { hash: req.auth!.hash } });
    reply.clearCookie(cookieName("editor"), { path: "/" });
    return { signedOut: true };
  });
}
