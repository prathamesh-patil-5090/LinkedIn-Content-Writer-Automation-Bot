import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';
import { MediaService } from '../media/media.service';
import { escapeLinkedInCommentary } from './commentary';

@Injectable()
export class LinkedInService {
  private readonly log = new Logger(LinkedInService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  configured(): boolean {
    return Boolean(
      this.config.get('LINKEDIN_CLIENT_ID') &&
        this.config.get('LINKEDIN_CLIENT_SECRET'),
    );
  }

  getAuthUrl(state: string) {
    const clientId = this.config.get<string>('LINKEDIN_CLIENT_ID');
    const redirect = encodeURIComponent(
      this.config.get<string>('LINKEDIN_REDIRECT_URI') || '',
    );
    const scope = encodeURIComponent(
      'openid profile email w_member_social',
    );
    return `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirect}&state=${encodeURIComponent(state)}&scope=${scope}`;
  }

  async exchangeCode(code: string) {
    const clientId = this.config.get<string>('LINKEDIN_CLIENT_ID') || '';
    const clientSecret =
      this.config.get<string>('LINKEDIN_CLIENT_SECRET') || '';
    const redirect =
      this.config.get<string>('LINKEDIN_REDIRECT_URI') || '';

    const tokenRes = await fetch(
      'https://www.linkedin.com/oauth/v2/accessToken',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirect,
        }),
      },
    );
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(
        tokenJson.error_description || 'LinkedIn token exchange failed',
      );
    }

    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    const me = (await meRes.json()) as { sub?: string };
    if (!me.sub) throw new Error('Could not resolve LinkedIn person id');

    const personUrn = `urn:li:person:${me.sub}`;
    const expiresAt = tokenJson.expires_in
      ? new Date(Date.now() + tokenJson.expires_in * 1000)
      : null;

    return {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token || null,
      expiresAt,
      personUrn,
    };
  }

  async saveConnection(
    userId: string,
    data: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date | null;
      personUrn: string;
    },
  ) {
    return this.prisma.linkedInConnection.upsert({
      where: { userId },
      update: {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        personUrn: data.personUrn,
        connectedAt: new Date(),
      },
      create: {
        userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        personUrn: data.personUrn,
      },
    });
  }

  async disconnect(userId: string) {
    await this.prisma.linkedInConnection.deleteMany({ where: { userId } });
  }

  async publishPendingRun(runId: string) {
    const conn = await this.prisma.linkedInConnection.findFirst({
      orderBy: { connectedAt: 'desc' },
    });
    if (!conn) throw new Error('LinkedIn not connected');

    const draft = await this.prisma.draft.findFirst({
      where: { runId, status: 'pending' },
      orderBy: { version: 'desc' },
    });
    if (!draft?.postText?.trim()) {
      throw new Error('No pending draft text to publish');
    }

    await this.prisma.draft.update({
      where: { id: draft.id },
      data: { status: 'approved' },
    });
    await this.prisma.run.update({
      where: { id: runId },
      data: { status: 'publishing', errorMessage: null },
    });

    try {
      const result = await this.publishText(
        conn.userId,
        draft.postText,
        draft.imageUrl,
      );
      await this.prisma.run.update({
        where: { id: runId },
        data: {
          status: 'published',
          publishedAt: new Date(),
          linkedinPostUrn: result.urn,
        },
      });
      await this.prisma.voiceSample.create({
        data: {
          title:
            draft.hook ||
            draft.sourceTitle ||
            `Published ${new Date().toISOString().slice(0, 10)}`,
          body: draft.postText,
          sourceUrl: draft.sourceLink,
          source: 'published_by_app',
          isActive: true,
        },
      });
      return { urn: result.urn };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.run.update({
        where: { id: runId },
        data: { status: 'pending_approval', errorMessage: message },
      });
      await this.prisma.draft.update({
        where: { id: draft.id },
        data: { status: 'pending' },
      });
      throw err;
    }
  }

  async publishText(
    userId: string,
    commentary: string,
    imageUrl?: string | null,
  ) {
    const conn = await this.prisma.linkedInConnection.findUnique({
      where: { userId },
    });
    if (!conn) throw new Error('LinkedIn not connected');

    const version =
      this.config.get('LINKEDIN_API_VERSION') || '202607';

    let mediaUrn: string | null = null;
    if (imageUrl) {
      try {
        mediaUrn = await this.uploadImage(conn.accessToken, conn.personUrn, imageUrl);
      } catch (err) {
        this.log.warn(
          `LinkedIn image upload failed, posting text only: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }

    const body: Record<string, unknown> = {
      author: conn.personUrn,
      commentary: escapeLinkedInCommentary(commentary),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (mediaUrn) {
      body.content = { media: { id: mediaUrn } };
    }

    const res = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': version,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }

    if (!res.ok) {
      this.log.error(`LinkedIn publish failed: ${text.slice(0, 500)}`);
      throw new Error(
        typeof json === 'object' &&
          json &&
          'message' in json &&
          typeof (json as { message: unknown }).message === 'string'
          ? (json as { message: string }).message
          : `LinkedIn publish failed (${res.status})`,
      );
    }

    const urn =
      res.headers.get('x-restli-id') ||
      (typeof json === 'object' &&
      json &&
      'id' in json &&
      typeof (json as { id: unknown }).id === 'string'
        ? (json as { id: string }).id
        : null);

    return { urn, response: json };
  }

  private async uploadImage(
    accessToken: string,
    personUrn: string,
    imageUrl: string,
  ) {
    const version = this.config.get('LINKEDIN_API_VERSION') || '202607';
    const { bytes, contentType } = await this.media.readImage(imageUrl);

    const initRes = await fetch(
      'https://api.linkedin.com/rest/images?action=initializeUpload',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': version,
        },
        body: JSON.stringify({
          initializeUploadRequest: { owner: personUrn },
        }),
      },
    );
    const initJson = (await initRes.json()) as {
      value?: { uploadUrl?: string; image?: string };
      message?: string;
    };
    const uploadUrl = initJson.value?.uploadUrl;
    const imageUrn = initJson.value?.image;
    if (!initRes.ok || !uploadUrl || !imageUrn) {
      throw new Error(initJson.message || `LinkedIn image init ${initRes.status}`);
    }

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': contentType || 'image/png',
        'Content-Length': String(bytes.length),
      },
      body: new Uint8Array(bytes),
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new Error(`LinkedIn image PUT ${putRes.status}: ${t.slice(0, 200)}`);
    }
    return imageUrn;
  }
}
