import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { canAccessPage, canEdit } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { signRoomTicket } from '@/lib/room-ticket';
import Editor from '@/components/Editor';
import Board from '@/components/Board';

export default async function Page({ params }: { params: Promise<{ pageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { pageId } = await params;
  const access = await canAccessPage(user.id, pageId);
  if (!access) notFound();

  const page = await prisma.page.findUnique({
    where: { id: pageId },
    include: { workspace: { select: { name: true } } },
  });
  if (!page) notFound();

  const ticket = await signRoomTicket({ pageId: page.id, userId: user.id, role: access.role });

  return (
    <main className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-white/5 px-5">
        <div className="flex items-center gap-3">
          <Link href="/app" className="text-sm text-violet-300 hover:text-violet-200">
            ← Workspace
          </Link>
          <span className="text-xs text-slate-600">
            {page.workspace.name} <span className="mx-1 text-slate-700">/</span> {page.title}
          </span>
        </div>
        <span className="text-xs text-slate-500">{user.name}</span>
      </header>
      <div className={`mx-auto px-5 py-7 ${page.type === 'BOARD' ? 'max-w-[1900px]' : 'max-w-[1500px]'}`}>
        {page.type === 'BOARD' ? (
          <Board
            pageId={page.id}
            title={page.title}
            canEdit={canEdit(access.role)}
            canComment={access.role !== 'VIEWER'}
            role={access.role}
            ticket={ticket}
            user={{ id: user.id, name: user.name }}
          />
        ) : (
          <Editor
            pageId={page.id}
            title={page.title}
            canEdit={canEdit(access.role)}
            canComment={access.role !== 'VIEWER'}
            role={access.role}
            ticket={ticket}
            user={{ id: user.id, name: user.name }}
          />
        )}
      </div>
    </main>
  );
}
