import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { signJWT } from './jwt';
import type { Env } from '../types/env';
import { getUserByGoogleID, createUser, updateUserToken } from '../db/users';

type HonoContext = Context<{ Bindings: Env }>;

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
}

export async function handleLogin(c: HonoContext) {
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URL,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return c.redirect(url, 307);
}

export async function handleCallback(c: HonoContext) {
  const code = c.req.query('code');
  if (!code) {
    return c.json({ error: 'No code in request' }, 400);
  }

  // Exchange code for token
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: c.env.GOOGLE_CLIENT_ID,
    client_secret: c.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: c.env.GOOGLE_REDIRECT_URL,
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  });

  if (!tokenRes.ok) {
    console.error('Token exchange failed:', await tokenRes.text());
    return c.json({ error: 'Failed to authenticate' }, 500);
  }

  const tokenData = (await tokenRes.json()) as GoogleTokenResponse;

  // Fetch user info
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userInfoRes.ok) {
    console.error('User info fetch failed:', await userInfoRes.text());
    return c.json({ error: 'Failed to get user info' }, 500);
  }

  const userInfo = (await userInfoRes.json()) as GoogleUserInfo;

  // Calculate token expiry
  const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const refreshToken = tokenData.refresh_token ?? '';

  // Create or update user in D1
  let user = await getUserByGoogleID(c.env.DB, userInfo.id);

  if (!user) {
    user = await createUser(c.env.DB, userInfo.email, userInfo.id, tokenData.access_token, refreshToken, tokenExpiry);
    console.log(`Created new user: ${userInfo.email}`);
  } else {
    await updateUserToken(
      c.env.DB,
      user.id,
      tokenData.access_token,
      refreshToken || user.refreshToken,
      tokenExpiry,
    );
    console.log(`Updated user token: ${userInfo.email}`);
  }

  // Sign JWT and set cookie
  const jwt = await signJWT({ userId: user.id, email: user.email }, c.env.JWT_SECRET);

  setCookie(c, 'auth', jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return c.redirect('/dashboard', 303);
}

export async function handleLogout(c: HonoContext) {
  deleteCookie(c, 'auth', { path: '/' });
  return c.redirect('/', 303);
}
