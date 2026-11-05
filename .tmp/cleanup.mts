import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const nadia = await prisma.user.findUnique({ where: { email: 'nadia@collabspace.dev' } });
if (nadia) {
  await prisma.comment.deleteMany({ where: { authorId: nadia.id } });
  const ws = await prisma.workspace.findMany({ where: { members: { some: { userId: nadia.id } } } });
  for (const w of ws) await prisma.workspace.delete({ where: { id: w.id } });
  await prisma.user.delete({ where: { id: nadia.id } });
  console.log('removed test account', nadia.email);
} else console.log('no test account');
await prisma.$disconnect();
