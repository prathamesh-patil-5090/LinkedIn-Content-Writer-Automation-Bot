import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.module';

@Injectable()
export class LinkedInService {
  private readonly log = new Logger(LinkedInService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

  async publishText(userId: string, commentary: string) {
    const conn = await this.prisma.linkedInConnection.findUnique({
      where: { userId },
    });
    if (!conn) throw new Error('LinkedIn not connected');

    const version =
      this.config.get('LINKEDIN_API_VERSION') || '202607';
    const res = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': version,
      },
      body: JSON.stringify({
        author: conn.personUrn,
        commentary,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      }),
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
}
