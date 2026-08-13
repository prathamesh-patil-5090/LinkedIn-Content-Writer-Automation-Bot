import {
  Controller,
  Delete,
  Get,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { LinkedInService } from './linkedin.service';
import {
  CurrentUser,
  SessionAuthGuard,
  SessionUser,
} from '../auth/session.guard';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

@Controller('linkedin')
export class LinkedInController {
  constructor(
    private readonly linkedin: LinkedInService,
    private readonly config: ConfigService,
  ) {}

  @Get('oauth/start')
  @UseGuards(SessionAuthGuard)
  start(@Req() req: Request, @Res() res: Response) {
    const state = randomBytes(16).toString('hex');
    req.session.linkedinOauthState = state;
    req.session.linkedinOauthUserId = req.session.userId;
    return res.redirect(this.linkedin.getAuthUrl(state));
  }

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const appUrl = this.config.get('APP_URL') || 'http://localhost:3000';
    if (error) {
      return res.redirect(`${appUrl}/settings?linkedin=error`);
    }
    if (!code || state !== req.session.linkedinOauthState) {
      return res.redirect(`${appUrl}/settings?linkedin=state`);
    }
    const userId = req.session.linkedinOauthUserId;
    if (!userId) {
      return res.redirect(`${appUrl}/login`);
    }
    try {
      const tokens = await this.linkedin.exchangeCode(code);
      await this.linkedin.saveConnection(userId, tokens);
      delete req.session.linkedinOauthState;
      delete req.session.linkedinOauthUserId;
      return res.redirect(`${appUrl}/settings?linkedin=connected`);
    } catch {
      return res.redirect(`${appUrl}/settings?linkedin=error`);
    }
  }

  @Delete('connection')
  @UseGuards(SessionAuthGuard)
  async disconnect(@CurrentUser() user: SessionUser) {
    await this.linkedin.disconnect(user.id);
    return { ok: true };
  }
}
