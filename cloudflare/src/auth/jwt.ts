import { SignJWT, jwtVerify } from 'jose';
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Env } from '../types/env';

export interface JWTPayload {
  userId: number;
  email: string;
}

export async function signJWT(payload: JWTPayload, secret: string): Promise<string> {
  const secretKey = new TextEncoder().encode(secret);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secretKey);
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const secretKey = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, secretKey);
  return {
    userId: payload.userId as number,
    email: payload.email as string,
  };
}

type AuthEnv = {
  Bindings: Env;
  Variables: {
    userId: number;
    email: string;
  };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, 'auth');
  if (!token) {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    c.set('userId', payload.userId);
    c.set('email', payload.email);
  } catch {
    return c.json({ error: 'Not authenticated' }, 401);
  }

  await next();
});
