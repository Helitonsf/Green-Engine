import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { Green15kModule } from './green15k/green15k.module';

@Module({ imports: [Green15kModule], controllers: [HealthController] })
export class AppModule {}
