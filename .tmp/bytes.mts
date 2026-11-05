import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const rows = await prisma.yjsState.findMany({ select: { pageId: true, state: true, updatedAt: true } });
for (const r of rows) console.log(r.pageId, r.state.byteLength, 'bytes', r.updatedAt.toISOString());
await prisma.$disconnect();
