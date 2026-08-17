import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const log = new Logger('PrismaService');

function isTransientDbError(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'P1017' ||
    code === 'P1001' ||
    code === 'P1008' ||
    code === 'P2024' ||
    /server has closed the connection/i.test(message) ||
    /can't reach database server/i.test(message) ||
    /connection terminated/i.test(message) ||
    /econnreset/i.test(message) ||
    /econnrefused/i.test(message) ||
    /connection timed out/i.test(message)
  );
}

export class PrismaService
  extends PrismaClient
  implements OnModuleDestroy
{
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

async function createPrisma() {
  const prisma = new PrismaService({
    log: ['warn', 'error'],
  });

  const client = prisma.$extends({
    query: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (!isTransientDbError(error)) throw error;
          log.warn('Database connection dropped (Neon idle) — reconnecting');
          await prisma.$disconnect().catch(() => undefined);
          await new Promise((r) => setTimeout(r, 800));
          await prisma.$connect();
          return query(args);
        }
      },
    },
  });

  let last: unknown;
  for (let i = 1; i <= 5; i++) {
    try {
      await prisma.$connect();
      return client as unknown as PrismaService;
    } catch (error) {
      last = error;
      log.warn(`DB connect attempt ${i}/5 failed`);
      await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw last;
}

@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: createPrisma,
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
