import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { io, Socket } from 'socket.io-client';

describe('WebSocket Gateway Test', () => {
  let app: INestApplication;
  let clientSocket: Socket;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      providers: [EventsGateway],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(3000);

    clientSocket = io('ws://localhost:8081/chat');
  });

  afterAll(async () => {
    clientSocket.close();
    await app.close();
  });

  it('WebSocket 서버에 연결할 수 있어야 한다.', (done) => {
    clientSocket.on('connect', () => {
      console.log('✅ 서버와 연결 성공:', clientSocket.id);
      expect(clientSocket.connected).toBeTruthy();
      done();
    });
  });

  it('채팅방에 참여하고 시스템 메시지를 받아야 한다.', (done) => {
    clientSocket.emit('joinRoom', { room: 'testRoom' });

    clientSocket.on('message', (data) => {
      console.log('📩 시스템 메시지 수신:', data);
      expect(data).toEqual({
        user: 'system',
        message: expect.stringContaining('has joined the room'),
      });
      done();
    });
  });

  it('채팅방에 메시지를 전송하고 받아야 한다.', (done) => {
    const testMessage = '테스트 메시지 전송!';

    clientSocket.emit('sendMessage', {
      room: 'testRoom',
      message: testMessage,
    });

    clientSocket.on('message', (data) => {
      if (data.message === testMessage) {
        console.log('📩 메시지 수신:', data);
        expect(data).toEqual({
          user: expect.any(String), // 클라이언트 ID
          message: testMessage,
        });
        done();
      }
    });
  });
});
