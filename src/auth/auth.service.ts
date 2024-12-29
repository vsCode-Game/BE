import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  async validateUser(userEmail: string, password: string): Promise<any> {
    // 여기에 데이터베이스 연동 코드 작성
    if (userEmail === 'test' && password === 'password') {
      return { userId: 1, username: 'test' };
    }
    return null;
  }
}
