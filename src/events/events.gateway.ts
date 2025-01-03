import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  namespace: 'chat',
  cors: { origin: '*' },
})
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private logger: Logger = new Logger('EventsGateway');

  private chatRooms: { [key: string]: string[] } = {}; // 방 정보 저장

  // 서버 초기화
  afterInit() {
    this.logger.log('웹소켓 서버 초기화 ✅');
    this.logger.log(
      `Socket.IO 서버 객체: ${this.server ? '정상 연결됨' : '연결 실패'}`,
    );
    console.log('WebSocket Server listening on port 8080 with namespace /chat'); // 디버깅 로그 추가
    console.log('웹소켓 서버가 초기화되었습니다.');
  }

  // 클라이언트 연결
  handleConnection(client: Socket) {
    this.logger.log(`Client Connected : ${client.id}`);
    console.log(`클라이언트가 연결되었습니다: ${client.id}`);
  }

  // 클라이언트 연결 해제
  handleDisconnect(client: Socket) {
    this.logger.log(`Client Disconnected : ${client.id}`);
    console.log(`클라이언트 연결이 해제되었습니다: ${client.id}`);

    // 모든 방에서 해당 클라이언트를 제거
    for (const room in this.chatRooms) {
      this.chatRooms[room] = this.chatRooms[room].filter(
        (id) => id !== client.id,
      );
      // 방에 남은 사용자가 없으면 삭제
      if (this.chatRooms[room].length === 0) {
        delete this.chatRooms[room];
        console.log(`방이 비어 삭제되었습니다: ${room}`);
      }
    }
  }

  // 유효성 검사 헬퍼 메서드
  private validateRoom(client: Socket, room: string): boolean {
    if (!room || typeof room !== 'string') {
      client.emit('error', { message: 'Invalid room name.' });
      console.log(`유효하지 않은 방 이름 요청: ${room}`);
      return false;
    }
    return true;
  }

  // 채팅 방 참여
  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { room: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { room } = data;

    // 방 이름 유효성 검사
    if (!this.validateRoom(client, room)) return;

    client.join(room); // Socket.IO 방 참여
    this.chatRooms[room] = this.chatRooms[room] || [];
    this.chatRooms[room].push(client.id);

    this.server.to(room).emit('message', {
      user: 'system',
      message: `User ${client.id} has joined the room.`,
    });

    this.logger.log(`Client ${client.id} joined room: ${room}`);
    console.log(
      `클라이언트가 방에 참여했습니다: ${client.id}, 방 이름: ${room}`,
    );
  }

  // 채팅 방 떠나기
  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @MessageBody() data: { room: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { room } = data;

    // 방 이름 유효성 검사
    if (!this.validateRoom(client, room)) return;

    client.leave(room); // Socket.IO 방 떠나기
    this.chatRooms[room] = this.chatRooms[room]?.filter(
      (id) => id !== client.id,
    );

    // 방에 남은 사용자가 없으면 삭제
    if (this.chatRooms[room]?.length === 0) {
      delete this.chatRooms[room];
      console.log(`방이 비어 삭제되었습니다: ${room}`);
    }

    this.server.to(room).emit('message', {
      user: 'system',
      message: `User ${client.id} has left the room.`,
    });

    this.logger.log(`Client ${client.id} left room: ${room}`);
    console.log(
      `클라이언트가 방에서 나갔습니다: ${client.id}, 방 이름: ${room}`,
    );
  }

  // 메시지 보내기
  @SubscribeMessage('sendMessage')
  handleMessage(
    @MessageBody() data: { room: string; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { room, message } = data;

    // 방 이름 유효성 검사
    if (!this.validateRoom(client, room)) return;

    if (!this.chatRooms[room]?.includes(client.id)) {
      client.emit('error', { message: 'You are not in this room.' });
      console.log(
        `메시지를 보내려 했으나 클라이언트가 방에 없습니다: ${client.id}, 방 이름: ${room}`,
      );
      return;
    }

    this.server.to(room).emit('message', { user: client.id, message });

    this.logger.log(`Message from ${client.id} in room ${room}: ${message}`);
    console.log(
      `메시지가 방에 전송되었습니다: ${message}, 보낸 사람: ${client.id}, 방 이름: ${room}`,
    );
  }
}
