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

@WebSocketGateway(8080, {
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
  }

  // 클라이언트 연결
  handleConnection(client: Socket) {
    this.logger.log(`Client Connected : ${client.id}`);
  }

  // 클라이언트 연결 해제
  handleDisconnect(client: Socket) {
    this.logger.log(`Client Disconnected : ${client.id}`);

    // 모든 방에서 해당 클라이언트를 제거
    for (const room in this.chatRooms) {
      this.chatRooms[room] = this.chatRooms[room].filter(
        (id) => id !== client.id,
      );
      // 방에 남은 사용자가 없으면 삭제
      if (this.chatRooms[room].length === 0) {
        delete this.chatRooms[room];
      }
    }
  }

  // 채팅 방 참여
  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { room: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { room } = data;

    client.join(room); // Socket.IO 방 참여
    this.chatRooms[room] = this.chatRooms[room] || [];
    this.chatRooms[room].push(client.id);

    this.server.to(room).emit('message', {
      user: 'system',
      message: `User ${client.id} has joined the room.`,
    });

    this.logger.log(`Client ${client.id} joined room: ${room}`);
  }

  // 채팅 방 떠나기
  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @MessageBody() data: { room: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { room } = data;

    client.leave(room); // Socket.IO 방 떠나기
    this.chatRooms[room] = this.chatRooms[room]?.filter(
      (id) => id !== client.id,
    );

    // 방에 남은 사용자가 없으면 삭제
    if (this.chatRooms[room]?.length === 0) {
      delete this.chatRooms[room];
    }

    this.server.to(room).emit('message', {
      user: 'system',
      message: `User ${client.id} has left the room.`,
    });

    this.logger.log(`Client ${client.id} left room: ${room}`);
  }

  // 메시지 보내기
  @SubscribeMessage('sendMessage')
  handleMessage(
    @MessageBody() data: { room: string; message: string },
    @ConnectedSocket() client: Socket,
  ) {
    const { room, message } = data;

    if (!this.chatRooms[room]?.includes(client.id)) {
      client.emit('error', { message: 'You are not in this room.' });
      return;
    }

    this.server.to(room).emit('message', { user: client.id, message });

    this.logger.log(`Message from ${client.id} in room ${room}: ${message}`);
  }
}
