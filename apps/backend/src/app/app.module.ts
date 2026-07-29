import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PollsModule } from './polls/polls.module';
import { PrismaModule } from './prisma/prisma.module';
import { VotingLgpdService } from './lgpd/voting-lgpd.service';
import { VotingGrpcServerLifecycle } from './grpc/voting-grpc.server';

@Module({
  imports: [PrismaModule, AuthModule, PollsModule],
  controllers: [AppController],
  providers: [AppService, VotingLgpdService, VotingGrpcServerLifecycle],
})
export class AppModule {}
