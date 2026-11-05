import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function loadRoomState(pageId: string): Promise<Uint8Array | null> {
  const row = await prisma.yjsState.findUnique({ where: { pageId }, select: { state: true } });
  return row ? new Uint8Array(row.state) : null;
}

export async function saveRoomState(pageId: string, state: Uint8Array) {
  const buffer = Buffer.from(state);
  await prisma.yjsState.upsert({
    where: { pageId },
    create: { pageId, state: buffer },
    update: { state: buffer },
  });
}

export async function pageExists(pageId: string) {
  const count = await prisma.page.count({ where: { id: pageId } });
  return count > 0;
}

/**
 * Roles as they are *right now* for the given users on the workspace that owns a page. Page
 * access is derived from the workspace membership, so a user missing from the result has been
 * removed, demoted out of the workspace, or had the page deleted.
 */
export async function rolesForPage(pageId: string, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { workspaceId: true } });
  if (!page) return new Map();
  const rows = await prisma.membership.findMany({
    where: { workspaceId: page.workspaceId, userId: { in: userIds } },
    select: { userId: true, role: true },
  });
  return new Map(rows.map(row => [row.userId, row.role as string]));
}

export async function closePersistence() {
  await prisma.$disconnect();
}
