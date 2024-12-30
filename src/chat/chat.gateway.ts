// @WebSocketGateway()
// export class ChatGateway {
//   @SubscribeMessage('message')
//   handleMessage(client: any, payload: any): string {
//     return 'Hello world!';
//   }
// }

// 클라이언트와 서버간에 통신할 수 있도록 지원
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

@WebSocketGateway({ namespace: '/chat', cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(private readonly chatService: ChatService) {}

  async handleConnection(socket: Socket) {
    // 클라이언트 연결 및 연결 해제를 처리
    console.log(`Client connected: ${socket.id}`);
    // 추가 구현 가능: 연결된 사용자 데이터를 저장하거나 초기화 작업 수행
  }

  async handleDisconnect(socket: Socket) {
    console.log(`Client disconnected: ${socket.id}`);
    // 추가 구현 가능: 사용자 데이터 정리 또는 클린업 작업
  }

  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { room: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const { room } = data;
    socket.join(room);
    this.server.to(room).emit('message', {
      user: 'system',
      message: `User ${socket.id} has joined the room.`,
    });
  }

  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @MessageBody() data: { room: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const { room } = data;
    socket.leave(room);
    this.server.to(room).emit('message', {
      user: 'system',
      message: `User ${socket.id} has left the room.`,
    });
  }

  @SubscribeMessage('sendMessage')
  handleMessage(
    @MessageBody() data: { room: string; message: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const { room, message } = data;
    // this.chatService.saveMessage(room, message); // 메시지 저장
    this.server.to(room).emit('message', { user: socket.id, message });
  }
}
