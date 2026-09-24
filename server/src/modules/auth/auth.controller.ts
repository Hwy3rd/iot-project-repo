import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { GetUserId } from '../../common/decorators/get-user-id.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Serialize } from '../../common/decorators/serialize.decorator';
import { JwtRefreshGuard } from '../../common/guards/jwt-refresh.guard';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private get isProd(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private baseCookieOptions(path: string): CookieOptions {
    return { httpOnly: true, secure: this.isProd, sameSite: 'lax', path };
  }

  private setAuthCookies(res: Response, tokens: IssuedTokens): void {
    const accessCookieName =
      this.config.get<string>('COOKIE_NAME') ?? 'access_token';
    const refreshCookieName =
      this.config.get<string>('REFRESH_COOKIE_NAME') ?? 'refresh_token';

    res.cookie(accessCookieName, tokens.accessToken, {
      ...this.baseCookieOptions('/'),
      expires: new Date(tokens.accessTokenExpiresAt),
    });
    res.cookie(refreshCookieName, tokens.refreshToken, {
      ...this.baseCookieOptions('/auth'),
      expires: new Date(tokens.refreshTokenExpiresAt),
    });
  }

  private clearAuthCookies(res: Response): void {
    const accessCookieName =
      this.config.get<string>('COOKIE_NAME') ?? 'access_token';
    const refreshCookieName =
      this.config.get<string>('REFRESH_COOKIE_NAME') ?? 'refresh_token';

    res.clearCookie(accessCookieName, this.baseCookieOptions('/'));
    res.clearCookie(refreshCookieName, this.baseCookieOptions('/auth'));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Serialize(UserResponseDto)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, ...tokens } = await this.authService.login(dto, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
    this.setAuthCookies(res, tokens);
    return user;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(JwtRefreshGuard)
  async refresh(
    @GetUserId() userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.refreshTokens(userId);
    this.setAuthCookies(res, tokens);
    return null;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Public()
  @UseGuards(JwtRefreshGuard)
  async logout(
    @GetUserId() userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(userId);
    this.clearAuthCookies(res);
    return null;
  }

  @Get('me')
  @Serialize(UserResponseDto)
  me(@GetUserId() userId: string) {
    return this.usersService.findOne(userId);
  }
}
