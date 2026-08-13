require('../prisma/load-env.cjs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const run = await p.run.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { drafts: { orderBy: { version: 'desc' }, take: 1 } },
  });
  console.log(
    JSON.stringify(
      {
        id: run?.id,
        status: run?.status,
        error: run?.errorMessage,
        draftStatus: run?.drafts[0]?.status,
      },
      null,
      2,
    ),
  );

  if (
    run &&
    run.errorMessage?.includes('version') &&
    run.drafts[0]?.status === 'pending'
  ) {
    await p.run.update({
      where: { id: run.id },
      data: { status: 'pending_approval', errorMessage: null },
    });
    console.log('reset to pending_approval', run.id);
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
