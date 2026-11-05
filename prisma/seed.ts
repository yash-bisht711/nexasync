import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
async function main() {
  const email = 'demo@collabspace.dev';
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: 'Demo User', email, passwordHash: await bcrypt.hash('Demo1234!', 12) }
  });
  let workspace = await prisma.workspace.findFirst({ where: { name: 'Product Team', members: { some: { userId: user.id } } } });
  if (!workspace) workspace = await prisma.workspace.create({ data: { name: 'Product Team', members: { create: { userId: user.id, role: Role.OWNER } }, pages: { create: [{ title: 'Welcome to CollabSpace' }, { title: 'Project roadmap' }] } } });
  console.log(`Seeded ${email} / Demo1234!`);
}
main().finally(() => prisma.$disconnect());
