import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.use(cookieParser()); // 쿠키 파서 사용
  app.useGlobalPipes(new ValidationPipe());

  // 라우트 디버깅 활성화
  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('The API description')
    .setVersion('1.0')
    .addBearerAuth(
      // Swagger에 Bearer 토큰 설정 추가
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT', // JWT 사용 시 명시
      },
      'access-token', // 키 이름 (선택 사항)
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
