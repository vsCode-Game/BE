// game.gateway.ts

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
import { RedisService } from 'src/redis/redis.service';
import { GameService } from './game.service';

@WebSocketGateway({ namespace: '/game', cors: { origin: '*' } })
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // userSockets: userId -> socketId
  private userSockets: Map<number, string> = new Map();

  constructor(
    private readonly gameRoomService: GameRoomService,
    private readonly redisService: RedisService,
    private readonly gameService: GameService,
  ) {}

  afterInit(server: Server) {
    console.log('WebSocket initialized', server);
  }

  handleConnection(client: Socket) {
    console.log('try to connect ');
    try {
      // 1) 토큰 검증
      const token = client.handshake.auth.token.replace('Bearer ', '');
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
      const userId = Number(decoded?.userId);

      if (!Number.isFinite(userId)) {
        throw new Error('Invalid userId in token');
      }

      // 2) userId를 소켓에 저장 + userSockets 맵 갱신
      client.data.userId = userId;
      this.userSockets.set(userId, client.id);

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
    const userId = client.data.userId;

    // 소켓 연결 해제 시 userSockets에서 제거
    this.userSockets.delete(userId);

    // 사용자가 속해있던 방 확인 후 DB에서 제거
    const roomId = await this.gameRoomService.getRoomIdByClient(
      userId.toString(),
    );
    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('message', {
        sender: 'System',
        message: `User ${userId} has disconnected.`,
      });
    }
  }

  // ─────────────────────────────────────────
  // 방 입장 / 퇴장
  // ─────────────────────────────────────────

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    const alreadyInRoom = await this.gameRoomService.isUserInRoom(
      userId,
      roomId,
    );
    if (!alreadyInRoom) {
      await this.gameRoomService.joinRoom(roomId, userId);
    }

    client.join(roomId.toString());
    this.server.to(roomId.toString()).emit('message', {
      sender: 'System',
      message: `User ${userId} joined or re-joined the room.`,
    });
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('message', {
        sender: 'System',
        message: `User ${userId} has disconnected.`,
      });
    }
  }

  // ─────────────────────────────────────────
  // 채팅
  // ─────────────────────────────────────────
  @SubscribeMessage('message')
  async handleMessage(
    client: Socket,
    payload: { roomId: number; message: string },
  ) {
    const { roomId, message } = payload;
    const userId = client.data.userId;
    const isInRoom = await this.gameRoomService.isUserInRoom(userId, roomId);

    if (isInRoom) {
      // 브로드캐스트
      this.server
        .to(roomId.toString())
        .emit('message', { sender: userId, message });
    } else {
      client.emit('error', { message: 'You are not in this room.' });
    }
  }

  // ─────────────────────────────────────────
  // 게임 로직
  // ─────────────────────────────────────────

  /**
   * (1) 사용자가 "레디"를 누름 → 모두 레디 시 게임 시작
   */
  @SubscribeMessage('setReady')
  async handleSetReady(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    // 레디 상태 기록
    await this.redisService.set(`room:${roomId}:user:${userId}:ready`, 'true');

    // 전체에게 브로드캐스트 (사용자가 레디했다는 알림)
    this.server.to(roomId.toString()).emit('readyStatusChanged', {
      userId,
      ready: true,
    });

    // 모두 레디인지 확인
    const isAllReady = await this.gameService.checkAllPlayersReady(roomId);
    if (isAllReady) {
      // 게임 시작
      const players = await this.gameRoomService.getPlayersInRoom(roomId);
      const firstPlayerId = players[Math.floor(Math.random() * players.length)];

      // 초기 상태
      const initialGameState = {
        status: 'ongoing',
        turn: firstPlayerId,
        players: {},
      };

      // 플레이어 데이터
      players.forEach((pid) => {
        initialGameState.players[pid] = {
          blackCount: 0,
          whiteCount: 0,
          chosenInitialCards: false,
          finalHand: [],
        };
      });

      // Redis에 저장
      await this.redisService.set(
        `room:${roomId}:gameState`,
        JSON.stringify(initialGameState),
      );

      // "게임 시작" 자체는 모두에게 알림 가능 (누가 선공인지 정도는 알려줄 수 있음)
      this.server.to(roomId.toString()).emit('gameStarted', {
        starterUserId: firstPlayerId,
      });
    }
  }

  /**
   * (2) 흑/백 카드 개수 선택
   */
  @SubscribeMessage('chooseInitialCards')
  async handleChooseInitialCards(
    client: Socket,
    payload: { roomId: number; blackCount: number; whiteCount: number },
  ) {
    const { roomId, blackCount, whiteCount } = payload;
    const userId = client.data.userId;

    if (blackCount + whiteCount !== 4) {
      client.emit('error', {
        message: 'You must choose a total of 4 cards (black + white).',
      });
      return;
    }

    const gameStateStr = await this.redisService.get(
      `room:${roomId}:gameState`,
    );
    if (!gameStateStr) {
      client.emit('error', { message: 'Game not started or no state found.' });
      return;
    }

    const gameState = JSON.parse(gameStateStr);
    if (!gameState.players[userId]) {
      client.emit('error', { message: 'User not found in this room.' });
      return;
    }

    gameState.players[userId].blackCount = blackCount;
    gameState.players[userId].whiteCount = whiteCount;
    gameState.players[userId].chosenInitialCards = true;

    await this.redisService.set(
      `room:${roomId}:gameState`,
      JSON.stringify(gameState),
    );

    // 알려줄 필요가 있다면 (ex. "누가 몇 장 골랐다" 정도)
    this.server.to(roomId.toString()).emit('initialCardsChosen', {
      userId,
      blackCount,
      whiteCount,
    });

    // 모두 선택했는지 체크
    const allChosen = Object.values(gameState.players).every(
      (p: any) => p.chosenInitialCards,
    );
    if (allChosen) {
      // (3) 카드 랜덤 부여 (조커 포함), 정렬
      await this.gameService.assignRandomCards(roomId, gameState);

      // 새 상태 읽어오기
      const updatedGameStateStr = await this.redisService.get(
        `room:${roomId}:gameState`,
      );
      const updatedGameState = JSON.parse(updatedGameStateStr);

      // **개인에게만 최종 패 전달** (상대 카드 정보는 숨김)
      for (const pid of Object.keys(updatedGameState.players)) {
        // userSockets에서 해당 pid의 socketId 찾기
        const socketId = this.userSockets.get(Number(pid));
        if (!socketId) continue;

        const finalHand = updatedGameState.players[pid].finalHand;

        // 조커가 없으면, 이미 오름차순(검정이 하얀색보다 우선)으로 정렬됨
        // 조커가 있으면, 임시로 (맨끝 등) 놓여 있을 수 있음 -> 재배치 가능
        this.server.to(socketId).emit('yourFinalHand', {
          message: 'Your final hand is assigned.',
          finalHand,
        });
      }

      // "모두가 조합 선택 완료" 정도는 전체에 알릴 수 있음
      this.server.to(roomId.toString()).emit('bothInitialCardsChosen', {
        message:
          'Both players have chosen their initial combos (hidden from each other).',
      });
    }
  }

  /**
   * (3) 조커가 있는 유저만 "arrangeFinalHand" 가능
   *  - 같은 숫자(0~11)에서는 검정(black)이 항상 더 작게 취급됨
   */
  @SubscribeMessage('arrangeFinalHand')
  async handleArrangeFinalHand(
    client: Socket,
    payload: { roomId: number; newOrder: { color: string; num: number }[] },
  ) {
    const { roomId, newOrder } = payload;
    const userId = client.data.userId;

    const gameStateStr = await this.redisService.get(
      `room:${roomId}:gameState`,
    );
    if (!gameStateStr) {
      client.emit('error', { message: 'Game state not found or not started.' });
      return;
    }

    const gameState = JSON.parse(gameStateStr);
    const player = gameState.players[userId];
    if (!player) {
      client.emit('error', { message: 'User not found in this room.' });
      return;
    }

    // 조커 포함 여부 확인
    const hasJoker = player.finalHand.some((c: any) => c.num === -1);
    if (!hasJoker) {
      // 조커 없으면 재배치 불가
      client.emit('error', {
        message: 'You have no joker. Cannot rearrange hand.',
      });
      return;
    }

    // newOrder가 기존 카드와 동일한 카드들인지 유효성 검사
    const original = player.finalHand;
    if (
      newOrder.length !== original.length ||
      !newOrder.every((card) =>
        original.some((o: any) => o.color === card.color && o.num === card.num),
      )
    ) {
      client.emit('error', { message: 'Invalid card order.' });
      return;
    }

    // 재배치 후, 다시 오름차순 정렬은 하지 않음 (조커 위치를 사용자 맘대로)
    // 단, "같은 숫자"인 경우 black이 white보다 항상 앞서야 한다는 조건 반영
    // → 조커(-1)는 유저가 직접 지정하므로 그대로 둔다고 가정
    const rearranged = [...newOrder];

    // color 우선순위: black < white (단, num이 같을 때만)
    // 조커는 그대로 user가 넣은 위치를 존중
    // 구현 아이디어:
    //   1) 조커가 아닌 것들만 이 순서대로 한 번 나열한 뒤,
    //   2) 동일 숫자가 있으면 black->white가 되도록 swap
    // 하지만 사용자가 고른 순서를 100% 신뢰한다면, "유저가 규칙에 맞춰 놓는 것"을 전제로 해도 됨.
    // 여기서는 "최소한 black이 white보다 앞에 오도록" 간단 검증만 하겠습니다.
    for (let i = 0; i < rearranged.length - 1; i++) {
      const curr = rearranged[i];
      const next = rearranged[i + 1];
      if (
        curr.num === next.num &&
        curr.num !== -1 && // 둘 다 조커가 아니고,
        curr.color === 'white' &&
        next.color === 'black'
      ) {
        // 색상 순서가 어긋났음
        client.emit('error', {
          message: `Invalid arrangement: black must come before white for the same number.`,
        });
        return;
      }
    }

    // 최종 반영
    player.finalHand = rearranged;

    await this.redisService.set(
      `room:${roomId}:gameState`,
      JSON.stringify(gameState),
    );

    // 본인에게만 업데이트 알림
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit('finalHandArranged', {
        message: 'Your final hand arrangement is updated.',
        newOrder: rearranged,
      });
    }
  }
}
