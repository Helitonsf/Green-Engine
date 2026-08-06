import { Module } from '@nestjs/common';
import { Green15kController } from './green15k.controller';
import { Green15kService } from './green15k.service';

@Module({ controllers: [Green15kController], providers: [Green15kService] })
export class Green15kModule {}
