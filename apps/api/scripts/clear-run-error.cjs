require('../prisma/load-env.cjs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const run = await p.run.findFirst({ orderBy: { createdAt: 'desc' } });
  if (!run) {
    console.log('no run');
    await p.$disconnect();
    return;
  }
  const updated = await p.run.update({
    where: { id: run.id },
    data: { status: 'pending_approval', errorMessage: null },
  });
  console.log(updated.id, updated.status, updated.errorMessage);
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
