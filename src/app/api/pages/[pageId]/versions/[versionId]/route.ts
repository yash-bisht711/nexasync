import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { canAccessPage } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

type Ctx = { params: Promise<{ pageId: string; versionId: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { pageId, versionId } = await params;
  if (!(await canAccessPage(user.id, pageId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const version = await prisma.version.findFirst({
    where: { id: versionId, pageId },
    select: { id: true, label: true, createdAt: true, snapshot: true },
  });
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ version });
}
