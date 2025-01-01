import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.use(cookieParser()); // 쿠키 파서 사용
  app.useGlobalPipes(new ValidationPipe());

  // 라우트 디버깅 활성화
  const server = app.getHttpAdapter();
  // console.log('Routes:', server.getHttpServer()._events.request._router.stack);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
