import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

// No .listen() / HTTP server here on purpose — this process only consumes
// BullMQ queues, it never serves requests.
async function bootstrap() {
  process.env.MQTT_CLIENT_ROLE = 'worker';
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}
bootstrap();
