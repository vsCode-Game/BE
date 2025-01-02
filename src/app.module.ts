import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { env } from 'process';
import { UserModule } from 'src/user/user.module';
import { AuthModule } from './auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { GameroomModule } from './gameroom/gameroom.module';
import { GameroomModule } from './gameroom/gameroom.module';

@Module({
  imports: [
    UserModule,
    AuthModule,
    RedisModule,
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.MYSQL_HOST || 'mysql',
      port: 3306,
      username: 'root',
      password: process.env.MYSQL_ROOT_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      autoLoadEntities: true,
      synchronize: true,
    }),
    GameroomModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
