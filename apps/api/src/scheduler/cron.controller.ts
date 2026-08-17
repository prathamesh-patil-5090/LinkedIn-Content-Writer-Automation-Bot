import {
  Controller,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerService } from './scheduler.service';

/** Optional manual trigger. The live schedule is Nest @Cron on this process. */
@Controller('cron')
export class CronController {
  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerService,
  ) {}

  @Post('tick')
  tick(
    @Headers('authorization') authorization?: string,
    @Headers('x-cron-secret') cronHeader?: string,
    @Query('force') force?: string,
  ) {
    this.assertSecret(authorization, cronHeader);
    return this.scheduler.tick('http', force === '1' || force === 'true');
  }

  private assertSecret(authorization?: string, cronHeader?: string) {
    const expected = this.config.get<string>('CRON_SECRET');
    if (!expected) {
      throw new UnauthorizedException('CRON_SECRET is not configured');
    }
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice(7)
      : undefined;
    if (bearer !== expected && cronHeader !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }
  }
}
