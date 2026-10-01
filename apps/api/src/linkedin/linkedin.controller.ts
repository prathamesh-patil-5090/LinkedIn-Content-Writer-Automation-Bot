import {
  Controller,
  Delete,
  Get,
  Logger,
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
import {
  createLinkedInOauthState,
  verifyLinkedInOauthState,
} from './oauth-state';

@Controller('linkedin')
export class LinkedInController {
  private readonly log = new Logger(LinkedInController.name);

  constructor(
    private readonly linkedin: LinkedInService,
    private readonly config: ConfigService,
  ) {}

  private appUrl() {
    return (this.config.get('APP_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
  }

  @Get('oauth/start')
  @UseGuards(SessionAuthGuard)
  async start(
    @Req() req: Request,
    @Res() res: Response,
    @Query('mode') mode?: string,
  ) {
    const userId = req.session.userId;
    if (!userId) {
      return res.status(401).json({
        message: 'Not logged in',
        error: 'Unauthorized',
        statusCode: 401,
      });
    }

    const state = createLinkedInOauthState(userId);
    // Best-effort session mirror (signed state is authoritative on callback).
    req.session.linkedinOauthState = state;
    req.session.linkedinOauthUserId = userId;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    const url = this.linkedin.getAuthUrl(state);
    // SPA / cross-origin: frontend must call this with credentials, then redirect.
    const wantsJson =
      mode === 'json' ||
      (req.headers.accept || '').includes('application/json');
    if (wantsJson) {
      return res.json({ url });
    }
    return res.redirect(url);
  }

  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const appUrl = this.appUrl();
    if (error) {
      this.log.warn(
        `LinkedIn OAuth denied: ${error} ${errorDescription || ''}`.trim(),
      );
      return res.redirect(`${appUrl}/settings?linkedin=denied`);
    }

    const userId =
      verifyLinkedInOauthState(state || '') ||
      (state && state === req.session.linkedinOauthState
        ? req.session.linkedinOauthUserId
        : undefined);

    if (!code) {
      return res.redirect(`${appUrl}/settings?linkedin=missing`);
    }
    if (!userId) {
      this.log.warn('LinkedIn OAuth state invalid or expired');
      return res.redirect(`${appUrl}/settings?linkedin=state`);
    }

    try {
      const tokens = await this.linkedin.exchangeCode(code);
      await this.linkedin.saveConnection(userId, tokens);
      delete req.session.linkedinOauthState;
      delete req.session.linkedinOauthUserId;
      return res.redirect(`${appUrl}/settings?linkedin=connected`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'exchange failed';
      this.log.error(`LinkedIn token exchange failed: ${msg}`);
      return res.redirect(`${appUrl}/settings?linkedin=token`);
    }
  }

  @Delete('connection')
  @UseGuards(SessionAuthGuard)
  async disconnect(@CurrentUser() user: SessionUser) {
    await this.linkedin.disconnect(user.id);
    return { ok: true };
  }
}
