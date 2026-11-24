import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BrowserModule } from './browser/browser.module';
import { buildTypeOrmOptions } from './database/typeorm.config';
import { ProvidersModule } from './providers/providers.module';
import { ReplayModule } from './replay/replay.module';
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
    ProvidersModule,
    SearchModule,
    ReplayModule,
    UploadsModule,
  ],
})
export class AppModule {}
