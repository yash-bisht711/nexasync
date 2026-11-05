import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { canAccessPage } from '@/lib/permissions';
import { signRoomTicket } from '@/lib/room-ticket';

type Ctx = { params: Promise<{ pageId: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { pageId } = await params;
  const access = await canAccessPage(user.id, pageId);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const ticket = await signRoomTicket({ pageId, userId: user.id, role: access.role });
  return NextResponse.json({ ticket, role: access.role });
}
