import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { getUploadRoot } from './uploads/uploads.util';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useStaticAssets(getUploadRoot(config), {
    prefix: '/uploads/',
    index: false,
  });

  const port = Number.parseInt(config.get<string>('PORT') ?? '3000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`StickerFinder backend listening on http://localhost:${port}/api`);
}

void bootstrap();
