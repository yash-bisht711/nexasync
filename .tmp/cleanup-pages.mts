import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv[2] === '--apply';

// Only pages created as test scaffolding in this workspace, matched on their exact prefixes.
const prefixes = ['Fan-out probe ', 'Fan-out ', 'Diag ', 'Prov ', 'Revocation ', 'Redis scale check', 'Restore check'];

const pages = await prisma.page.findMany({ select: { id: true, title: true, createdAt: true, _count: { select: { comments: true, versions: true } } }, orderBy: { createdAt: 'asc' } });
const scratch = pages.filter(p => prefixes.some(prefix => p.title.startsWith(prefix)));
const kept = pages.filter(p => !scratch.includes(p));

console.log(`${apply ? 'deleting' : 'candidates'}: ${scratch.length}`);
for (const p of scratch) console.log(`  ${p.id}  ${p.title}  (${p._count.comments} comments, ${p._count.versions} versions)`);
console.log(`kept: ${kept.length}`);
for (const p of kept) console.log(`  ${p.id}  ${p.title}`);

if (apply) {
  for (const p of scratch) await prisma.page.delete({ where: { id: p.id } });
  console.log(`deleted ${scratch.length} page(s) with their state, comments and versions`);
}

await prisma.$disconnect();
