import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import * as path from 'path';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.module';
import { PrismaSessionStore } from './auth/prisma-session.store';
import { sessionCookieOpts } from './auth/cookie';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const prisma = app.get(PrismaService);

  app.setGlobalPrefix('api/v1');
  const uploadsDir = process.env.UPLOADS_DIR || './uploads';
  app.useStaticAssets(path.resolve(uploadsDir), { prefix: '/uploads' });
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(
    session({
      name: 'ldp.sid',
      secret: process.env.SESSION_SECRET || 'dev-only-change-me',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: new PrismaSessionStore(prisma),
      cookie: {
        ...sessionCookieOpts(),
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  app.enableCors({
    origin: appUrl,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT || process.env.API_PORT || 3001);
  await app.listen(port);
  console.log(`API listening on :${port}/api/v1`);
}

bootstrap();
