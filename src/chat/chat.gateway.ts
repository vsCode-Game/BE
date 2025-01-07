import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameRoomService } from '../gameRoom/gameRoom.service';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(private readonly gameRoomService: GameRoomService) {}

  afterInit(server: Server) {
    console.log('WebSocket initialized', server);
  }

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token.replace('Bearer ', '');
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
      const userId = Number(decoded?.userId);

      if (!Number.isFinite(userId)) {
        throw new Error('Invalid userId in token');
      }

      client.data.userId = userId; // 유효한 userId만 저장
      console.log('User connected:', userId);
      if (!client.handshake.auth.token) {
        console.error('No token provided. Disconnecting client.');
        client.disconnect();
        return;
      }

      console.log('Client connected successfully:', userId);
    } catch (error) {
      console.error('Invalid token or userId:', error.message);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);

    // 1) userId를 client.data.userId 로 가져옴
    const userId = client.data.userId;

    // 2) DB에서 userId를 이용해 어느 방에 있었는지 찾기
    const roomId = await this.gameRoomService.getRoomIdByClient(
      userId.toString(),
    );

    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('message', {
        sender: 'System',
        // 소켓 식별자는 client.id, 그러나 실제 "유저명"을 보여주려면 userId를 써도 됨
        message: `User ${userId} has disconnected.`,
      });
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId; // handleConnection에서 이미 검증된 값

    // (1) 이미 DB상으로 방에 있는지 확인
    const alreadyInRoom = await this.gameRoomService.isUserInRoom(
      userId,
      roomId,
    );

    // (2) DB에 참여 기록이 없을 때만 실제 joinRoom 호출
    if (!alreadyInRoom) {
      await this.gameRoomService.joinRoom(roomId, userId);
    } else {
      console.log(`User ${userId} already in room ${roomId}, skipping DB join`);
    }

    // (3) 소켓 레벨에서 방 join (항상 수행)
    client.join(roomId.toString());

    // (4) 메시지 브로드캐스트
    this.server.to(roomId.toString()).emit('message', {
      sender: 'System',
      message: `User ${userId} joined or re-joined the room.`,
    });
  }

  @SubscribeMessage('message')
  async handleMessage(
    client: Socket,
    payload: { roomId: number; message: string },
  ) {
    const { roomId, message } = payload;
    const isInRoom = await this.gameRoomService.isUserInRoom(
      client.data.userId,
      roomId,
    );
    if (isInRoom) {
      this.server
        .to(roomId.toString())
        .emit('message', { sender: client.data.userId, message });
    } else {
      client.emit('error', { message: 'You are not in this room.' });
    }
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;

    // const token = client.handshake.auth.token.replace('Bearer ', '');
    // const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
    // const userId = Number(decoded?.userId);
    const userId = client.data.userId;

    console.log(userId, ' want to leave', roomId, 'room');

    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('message', {
        sender: 'System',
        message: `User ${userId} has disconnected.`,
      });
    }
  }
}
