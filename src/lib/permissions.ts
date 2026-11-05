import { Role } from '@prisma/client';
import { prisma } from './prisma';
export async function getMembership(userId: string, workspaceId: string) {
  return prisma.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId } } });
}
export async function canAccessPage(userId: string, pageId: string) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true, workspaceId: true } });
  if (!page) return null;
  const membership = await getMembership(userId, page.workspaceId);
  return membership ? { page, role: membership.role } : null;
}
export function canEdit(role: Role) { return role === 'OWNER' || role === 'EDITOR'; }
export function canComment(role: Role) { return role !== 'VIEWER'; }
export function canManageMembers(role: Role) { return role === 'OWNER'; }
