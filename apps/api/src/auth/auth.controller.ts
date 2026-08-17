import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.module';
import { CurrentUser, SessionAuthGuard, SessionUser } from './session.guard';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

@Controller()
export class AuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Req() req: Request) {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    const ok = await bcrypt.compare(body.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid email or password');

    req.session.userId = user.id;
    req.session.email = user.email;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });

    const linkedin = await this.prisma.linkedInConnection.findUnique({
      where: { userId: user.id },
    });

    return {
      id: user.id,
      email: user.email,
      linkedinConnected: Boolean(linkedin),
    };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((err) => (err ? reject(err) : resolve()));
    });
    res.clearCookie('ldp.sid', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  async me(@CurrentUser() user: SessionUser) {
    const linkedin = await this.prisma.linkedInConnection.findUnique({
      where: { userId: user.id },
    });
    return {
      id: user.id,
      email: user.email,
      linkedinConnected: Boolean(linkedin),
    };
  }
}
