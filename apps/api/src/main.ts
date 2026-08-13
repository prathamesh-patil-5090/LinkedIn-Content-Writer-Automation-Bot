import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix('api/v1');
  const uploadsDir = process.env.UPLOADS_DIR || './uploads';
  app.useStaticAssets(path.resolve(uploadsDir), { prefix: '/uploads' });
  app.use(cookieParser());
  app.use(
    session({
      name: 'ldp.sid',
      secret: process.env.SESSION_SECRET || 'dev-only-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24 * 30,
      },
    }),
  );

  app.enableCors({
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
