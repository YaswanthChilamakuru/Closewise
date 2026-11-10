import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";

const COOKIE = "cw_session";
const MAX_AGE_MS = 30 * 86_400_000;

export const newMcpToken = () => crypto.randomBytes(24).toString("base64url");
export const mcpUrl = (u: Pick<User, "mcpToken">) => `${env.APP_URL}/mcp/${u.mcpToken}`;

function setSession(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId }, env.JWT_SECRET, { algorithm: "HS256", expiresIn: "30d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: MAX_AGE_MS,
    path: "/",
  });
}

export type AuthedRequest = Request & { user: User };

/** The signed-in user's id from the session cookie, or null (no DB lookup). */
export function sessionUserId(req: Request): string | null {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    return typeof payload === "object" && typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Loads the signed-in user from the session cookie, or answers 401. */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in" });
  let userId: string;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || typeof payload.sub !== "string") throw new Error("bad payload");
    userId = payload.sub;
  } catch {
    res.clearCookie(COOKIE, { path: "/" });
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.clearCookie(COOKIE, { path: "/" });
    return res.status(401).json({ error: "Not signed in" });
  }
  (req as AuthedRequest).user = user;
  next();
}

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, mcpUrl: mcpUrl(u) });

const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, "Enter your password").max(200) });
const signupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(100),
  email: emailSchema,
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid input";

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const { name, email, password } = parsed.data;
  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await bcrypt.hash(password, 10), mcpToken: newMcpToken() },
    });
    setSession(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      return res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
    throw err;
  }
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const ok = user && (await bcrypt.compare(parsed.data.password, user.passwordHash));
  if (!user || !ok) return res.status(401).json({ error: "Wrong email or password" });
  setSession(res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});
