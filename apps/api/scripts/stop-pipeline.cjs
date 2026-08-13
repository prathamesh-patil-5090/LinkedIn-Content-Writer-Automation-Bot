require('../prisma/load-env.cjs');
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const generating = [
    'collecting',
    'researching',
    'ranking',
    'writing',
    'imaging',
    'regenerating',
    'publishing',
    'pending_approval',
  ];

  const inFlight = await p.run.findMany({
    where: { status: { in: generating } },
    orderBy: { createdAt: 'desc' },
  });

  console.log(
    'inFlight',
    JSON.stringify(
      inFlight.map((r) => ({ id: r.id, status: r.status })),
      null,
      2,
    ),
  );

  if (inFlight.length) {
    const ids = inFlight.map((r) => r.id);
    await p.run.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'failed',
        errorMessage: 'Stopped by user',
      },
    });
    await p.draft.updateMany({
      where: { runId: { in: ids }, status: 'pending' },
      data: { status: 'rejected', feedback: 'stopped' },
    });
    console.log('stopped', ids);
  } else {
    console.log('nothing to stop');
  }

  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
