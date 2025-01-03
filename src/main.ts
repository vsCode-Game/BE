import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { IoAdapter } from '@nestjs/platform-socket.io'; // IoAdapter 추가

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.use(cookieParser()); // 쿠키 파서 사용
  app.useGlobalPipes(new ValidationPipe());

  // 라우트 디버깅 활성화
  // const server = app.getHttpAdapter();
  // console.log('Routes:', server.getHttpServer()._events.request._router.stack);

  // WebSocket과 HTTP 서버를 통합
  const httpServer = app.getHttpAdapter().getInstance(); // HTTP 서버 인스턴스
  app.useWebSocketAdapter(new IoAdapter(httpServer)); // WebSocket과 HTTP 통합

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
