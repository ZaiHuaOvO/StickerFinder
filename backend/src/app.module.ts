import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from './ai/ai.module';
import { BrowserModule } from './browser/browser.module';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { ProvidersModule } from './providers/providers.module';
import { SearchModule } from './search/search.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    BrowserModule,
    AiModule,
    ProvidersModule,
    SearchModule,
    UploadsModule,
  ],
})
export class AppModule {}
