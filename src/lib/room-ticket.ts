import { SignJWT, jwtVerify } from 'jose';

export type RoomTicketPayload = {
  pageId: string;
  userId: string;
  role: string;
};

const secret = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'dev-only-change-this-secret-before-deploying-123456',
);

const AUDIENCE = 'collabspace-room';

export async function signRoomTicket(payload: RoomTicketPayload, expiresInSeconds = 60 * 60 * 12) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(secret);
}

export async function verifyRoomTicket(token: string): Promise<RoomTicketPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { audience: AUDIENCE });
    const { pageId, userId, role } = payload as unknown as Record<string, string>;
    if (!pageId || !userId || !role) return null;
    return { pageId, userId, role };
  } catch {
    return null;
  }
}
