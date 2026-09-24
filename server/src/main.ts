import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

// Express `trust proxy` from TRUST_PROXY: "true"/"false", a hop count ("1"),
// or a subnet/preset list ("loopback, 10.0.0.0/8"). Unset = don't trust any
// proxy, so req.ip is the direct peer. Must be set when running behind a
// reverse proxy, or req.ip (recorded in audit logs) is the proxy's address;
// never enable it without one, or clients can spoof X-Forwarded-For.
function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY.trim()));
  }
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Explicit rather than relying on auto-detection, so it's obvious this app
  // serves both REST and WebSocket (RealtimeGateway) on the same HTTP server.
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
