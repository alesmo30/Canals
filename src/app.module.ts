import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from './infrastructure/config/config.module';

// Placeholder scaffold module from `nest new`. Step 10 (Modules and
// entrypoints) replaces this with the real ApiModule/WorkerModule pair
// built on SharedModule; ConfigModule moves there with them. Wired in here
// for now so config validation is provable at boot ahead of that step.
@Module({
  imports: [ConfigModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
