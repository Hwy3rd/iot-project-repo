import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppModule (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirrors main.ts's bootstrap() — the TestingModule doesn't go through
    // it, so the global ValidationPipe has to be set here too.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  // Every route requires auth by default (RbacModule's global JwtAuthGuard)
  // and every error response goes through GlobalExceptionFilter's
  // {success:false,...} envelope — this replaces the old boilerplate
  // expectation of 200 + a plain array, which RBAC and the response
  // envelope both broke.
  it('/users (GET) is rejected without an access token', () => {
    return request(app.getHttpServer())
      .get('/users')
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ success: false, statusCode: 401 });
      });
  });

  it('/auth/login (POST) rejects invalid credentials with the standard error envelope', () => {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: 'does-not-exist', password: 'wrong' })
      .expect(401)
      .expect((res) => {
        expect(res.body).toMatchObject({ success: false, statusCode: 401 });
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
