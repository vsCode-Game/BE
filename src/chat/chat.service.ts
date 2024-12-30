import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatService {
  // 채팅 모듈에 공통적으로 사용되는 로직 추가
  //   private messages = [];
  saveMessage(room: string, message: string): void {
    // const chat = { room, message, timestamp: new Date() };
    // this.messages.push(chat);
    console.log(`방 ${room}에 메시지를 저장 중: ${message}`);
    // 예: 메시지를 데이터베이스에 저장, 채팅 기록 저장, 사용자 관리 등
  }
}
