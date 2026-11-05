import { NextResponse } from 'next/server'; import { getCurrentUser } from '@/lib/auth'; import { getMembership, canManageMembers } from '@/lib/permissions'; import { prisma } from '@/lib/prisma'; import { memberRoleSchema } from '@/lib/validation'; import { Role } from '@prisma/client';
type Ctx = { params: Promise<{ workspaceId: string; membershipId: string }> };

async function ownerAccess(userId: string, workspaceId: string) {
  const access = await getMembership(userId, workspaceId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!canManageMembers(access.role)) return NextResponse.json({ error: 'Only the workspace owner can change members.' }, { status: 403 });
  return null;
}

// A workspace with zero owners would have nobody left who can manage it, so the last one is protected.
async function isLastOwner(workspaceId: string, membershipId: string) {
  const owners = await prisma.membership.count({ where: { workspaceId, role: Role.OWNER } });
  if (owners > 1) return false;
  return Boolean(await prisma.membership.findFirst({ where: { id: membershipId, workspaceId, role: Role.OWNER }, select: { id: true } }));
}

const select = { id: true, role: true, userId: true, user: { select: { name: true, email: true } } };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { workspaceId, membershipId } = await params;
  const denied = await ownerAccess(user.id, workspaceId);
  if (denied) return denied;
  const parsed = memberRoleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choose a valid role.' }, { status: 400 });
  const target = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId }, select: { id: true, role: true } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parsed.data.role !== Role.OWNER && await isLastOwner(workspaceId, target.id))
    return NextResponse.json({ error: 'A workspace needs at least one owner. Promote another member first.' }, { status: 400 });
  const membership = await prisma.membership.update({ where: { id: target.id }, data: { role: parsed.data.role as Role }, select });
  return NextResponse.json({ membership });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { workspaceId, membershipId } = await params;
  const denied = await ownerAccess(user.id, workspaceId);
  if (denied) return denied;
  const target = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId }, select: { id: true } });
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (await isLastOwner(workspaceId, target.id))
    return NextResponse.json({ error: 'A workspace needs at least one owner. Promote another member first.' }, { status: 400 });
  await prisma.membership.delete({ where: { id: target.id } });
  return NextResponse.json({ ok: true });
}
