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
import * as jwt from 'jsonwebtoken';

import { RedisService } from 'src/redis/redis.service';
import { GameRoomService } from '../gameRoom/gameRoom.service';
import { GameService, GameState } from './game.service';

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
    console.log('WebSocket initialized');
  }

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token?.replace('Bearer ', '');
      if (!token) throw new Error('No token provided');
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET);
      const userId = Number(decoded?.userId);
      if (!Number.isFinite(userId)) throw new Error('Invalid userId');
      client.data.userId = userId;
      this.userSockets.set(userId, client.id);
      console.log(`User connected: ${userId}`);
    } catch (err) {
      console.error(err.message);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
    const userId = client.data.userId;
    this.userSockets.delete(userId);

    const roomId = await this.gameRoomService.getRoomIdByClient(
      userId.toString(),
    );
    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('message', {
        sender: 'System',
        message: `User ${userId} disconnected.`,
      });
    }
  }

  // ─────────────────────────────────────────
  // 방 입/퇴장
  // ─────────────────────────────────────────

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;
    const inRoom = await this.gameRoomService.isUserInRoom(userId, roomId);
    if (!inRoom) {
      await this.gameRoomService.joinRoom(roomId, userId);
    }
    client.join(roomId.toString());
    this.server.to(roomId.toString()).emit('message', {
      sender: 'System',
      message: `User ${userId} joined the room.`,
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
        message: `User ${userId} left the room.`,
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

    const inRoom = await this.gameRoomService.isUserInRoom(userId, roomId);
    if (!inRoom) {
      client.emit('error', { message: 'You are not in this room.' });
      return;
    }
    this.server
      .to(roomId.toString())
      .emit('message', { sender: userId, message });
  }

  // ─────────────────────────────────────────
  // (1) setReady
  // ─────────────────────────────────────────
  @SubscribeMessage('setReady')
  async handleSetReady(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    await this.redisService.set(`room:${roomId}:user:${userId}:ready`, 'true');
    this.server
      .to(roomId.toString())
      .emit('readyStatusChanged', { userId, ready: true });

    const allReady = await this.gameService.checkAllPlayersReady(roomId);
    if (!allReady) return;

    const players = await this.gameRoomService.getPlayersInRoom(roomId);
    if (players.length !== 2) return;

    const firstPlayerId = players[Math.floor(Math.random() * players.length)];

    const gameState: GameState = {
      status: 'ongoing',
      turn: firstPlayerId,
      alreadyRevealed: false,
      players: {},
      blackDeck: [],
      whiteDeck: [],
    };

    players.forEach((pid) => {
      gameState.players[pid] = {
        finalHand: [],
        arrangementDone: false,
        blackCount: 0,
        whiteCount: 0,
      };
    });

    const blackDeck = Array.from({ length: 12 }, (_, i) => ({
      color: 'black',
      num: i,
    }));
    blackDeck.push({ color: 'black', num: -1 });
    const whiteDeck = Array.from({ length: 12 }, (_, i) => ({
      color: 'white',
      num: i,
    }));
    whiteDeck.push({ color: 'white', num: -1 });

    this.gameService.shuffle(blackDeck);
    this.gameService.shuffle(whiteDeck);

    gameState.blackDeck = blackDeck;
    gameState.whiteDeck = whiteDeck;

    await this.saveGameState(roomId, gameState);

    this.server.to(roomId.toString()).emit('gameStarted', {
      starterUserId: firstPlayerId,
      message: `Game started! First: ${firstPlayerId}`,
    });
    this.server.to(roomId.toString()).emit('turnStarted', {
      turnUserId: firstPlayerId,
      message: `It's user ${firstPlayerId}'s turn.`,
    });
  }

  // ─────────────────────────────────────────
  // (2) chooseInitialCards
  // ─────────────────────────────────────────
  @SubscribeMessage('chooseInitialCards')
  async handleChooseInitialCards(
    client: Socket,
    payload: { roomId: number; blackCount: number; whiteCount: number },
  ) {
    const { roomId, blackCount, whiteCount } = payload;
    const userId = client.data.userId;

    if (blackCount + whiteCount !== 4) {
      client.emit('error', {
        message: 'Must pick exactly 4 cards (black+white=4).',
      });
      return;
    }

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: 'No game state found.' });
      return;
    }
    if (!st.players[userId]) {
      client.emit('error', { message: 'Invalid user or room.' });
      return;
    }

    st.players[userId].blackCount = blackCount;
    st.players[userId].whiteCount = whiteCount;

    await this.saveGameState(roomId, st);

    this.server.to(roomId.toString()).emit('initialCardsChosen', {
      userId,
      blackCount,
      whiteCount,
    });

    // 모두 골랐나?
    const allChosen = Object.values(st.players).every(
      (p) => p.blackCount + p.whiteCount === 4,
    );
    if (!allChosen) return;

    // 실제 4장씩 뽑기
    for (const pidStr of Object.keys(st.players)) {
      const pid = Number(pidStr);
      const pState = st.players[pid];
      const arr: { color: string; num: number }[] = [];
      for (let i = 0; i < pState.blackCount; i++) {
        const c = st.blackDeck.pop();
        if (!c) {
          client.emit('error', { message: 'No more black cards left.' });
          return;
        }
        arr.push(c);
      }
      for (let i = 0; i < pState.whiteCount; i++) {
        const c = st.whiteDeck.pop();
        if (!c) {
          client.emit('error', { message: 'No more white cards left.' });
          return;
        }
        arr.push(c);
      }

      // 여기서 조커가 있어도 절대 맨 뒤로 안 보낼 수도 있음
      // 예: 간단히 compareCard로 sort하면 조커가 뒤로 감.
      // => "사용자"가 이후 arrnageFinalHand로 옮길 수 있음
      arr.sort((a, b) => this.gameService.compareCard(a, b));

      pState.finalHand = arr;
      const hasJoker = arr.some((x) => x.num === -1);
      if (!hasJoker) {
        pState.arrangementDone = true;
      }
    }

    await this.saveGameState(roomId, st);

    // 본인에게 전송
    for (const pidStr of Object.keys(st.players)) {
      const pid = Number(pidStr);
      const sockId = this.userSockets.get(pid);
      if (!sockId) continue;

      const arr = st.players[pid].finalHand;
      this.server.to(sockId).emit('yourFinalHand', {
        message: 'Your initial 4 cards assigned.',
        finalHand: arr,
      });
    }

    this.server.to(roomId.toString()).emit('bothInitialCardsChosen', {
      message: 'Both players have 4 cards now.',
    });

    this.checkAndRevealColorArrays(roomId);
  }

  // ─────────────────────────────────────────
  // (3) arrangeFinalHand
  // ─────────────────────────────────────────
  @SubscribeMessage('arrangeFinalHand')
  async handleArrangeFinalHand(
    client: Socket,
    payload: { roomId: number; newOrder: { color: string; num: number }[] },
  ) {
    const { roomId, newOrder } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: 'No game state found.' });
      return;
    }
    if (!st.players[userId]) {
      client.emit('error', { message: 'Invalid user or room.' });
      return;
    }
    const pState = st.players[userId];
    const oldArr = [...pState.finalHand];

    if (newOrder.length !== oldArr.length) {
      client.emit('error', { message: 'Invalid newOrder length.' });
      return;
    }
    for (const c of newOrder) {
      if (!oldArr.some((x) => x.color === c.color && x.num === c.num)) {
        client.emit('error', { message: 'newOrder has unknown card.' });
        return;
      }
    }

    // 검정<흰
    for (let i = 0; i < newOrder.length - 1; i++) {
      if (
        newOrder[i].num !== -1 &&
        newOrder[i + 1].num !== -1 &&
        newOrder[i].num === newOrder[i + 1].num &&
        newOrder[i].color === 'white' &&
        newOrder[i + 1].color === 'black'
      ) {
        client.emit('error', { message: '동일 숫자는 black < white.' });
        return;
      }
    }

    pState.finalHand = newOrder;
    pState.arrangementDone = true;

    await this.saveGameState(roomId, st);

    const sockId = this.userSockets.get(userId);
    if (sockId) {
      this.server.to(sockId).emit('finalHandArranged', {
        message: 'Your final hand arrangement updated.',
        newOrder,
      });
    }

    this.checkAndRevealColorArrays(roomId);
  }

  // ─────────────────────────────────────────
  // (4) drawCard
  // ─────────────────────────────────────────
  @SubscribeMessage('drawCard')
  async handleDrawCard(
    client: Socket,
    payload: { roomId: number; color: string },
  ) {
    const { roomId, color } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: 'No game state found.' });
      return;
    }
    if (st.turn !== userId) {
      client.emit('error', { message: 'Not your turn.' });
      return;
    }

    let card = null;
    if (color === 'black') {
      card = st.blackDeck.pop();
    } else {
      card = st.whiteDeck.pop();
    }
    if (!card) {
      client.emit('error', { message: `No more ${color} cards left.` });
      return;
    }

    const pState = st.players[userId];
    const oldArr = [...pState.finalHand];

    // 조커 뽑음?
    if (card.num === -1) {
      // 유저가 직접 위치를 선택
      pState.finalHand.push(card);
      await this.saveGameState(roomId, st);

      const sockId = this.userSockets.get(userId);
      if (sockId) {
        const idx = pState.finalHand.length - 1;
        this.server.to(sockId).emit('cardDrawn', {
          newCard: card,
          finalHand: pState.finalHand,
          drawnIndex: idx,
          message: 'You drew a Joker. Place it anywhere you want.',
        });
        this.server.to(sockId).emit('arrangeNewlyDrawnRequested', {
          message: 'Joker drawn. Please rearrange if needed.',
          newlyDrawn: card,
          currentHand: pState.finalHand,
        });
      }
      return;
    }

    // 숫자 카드 => 조커 위치는 안 건드림
    // 그냥 finalHand 내에서 "오름차순 인덱스" 찾되, 조커 skip?
    // 여기서는 간단히 "이미 정렬돼있다고 가정" -> 직접 삽입 위치 계산
    const newHand = [...pState.finalHand];
    // 한 줄 로직: find an index i such that newCard<num
    let insertIndex = 0;
    for (let i = 0; i < newHand.length; i++) {
      // 조커는 그냥 넘어감 => if(newHand[i].num===-1) { continue; }
      if (newHand[i].num === -1) {
        // 건너뛰고 insertIndex 계속 증가
        insertIndex = i + 1;
        continue;
      }
      // compare
      if (this.gameService.compareCard(card, newHand[i]) < 0) {
        insertIndex = i;
        break;
      } else {
        insertIndex = i + 1;
      }
    }
    newHand.splice(insertIndex, 0, card);

    pState.finalHand = newHand;
    await this.saveGameState(roomId, st);

    const sockId = this.userSockets.get(userId);
    if (sockId) {
      this.server.to(sockId).emit('cardDrawn', {
        newCard: card,
        finalHand: pState.finalHand,
        drawnIndex: insertIndex,
        message: `You drew ${card.color}${card.num} at index=${insertIndex}`,
      });
    }
    this.broadcastNewCardPosition(roomId, userId, card, insertIndex);

    // "조커 양옆" 범위인지?
    // => gameService.isNearJokerRange(newHand, card)
    const isNear = this.gameService.isNearJokerRange(newHand, card);
    if (isNear) {
      // "You drew a card near Joker range. You can rearrange if you want."
      this.server.to(sockId).emit('arrangeNewlyDrawnRequested', {
        message:
          'You drew a card near Joker range. You can rearrange if you want.',
        newlyDrawn: card,
        currentHand: pState.finalHand,
      });
    }
  }

  // ─────────────────────────────────────────
  // (5) 새 카드 수동 배치
  // ─────────────────────────────────────────
  @SubscribeMessage('arrangeNewlyDrawn')
  async handleArrangeNewlyDrawn(
    client: Socket,
    payload: { roomId: number; newOrder: { color: string; num: number }[] },
  ) {
    const { roomId, newOrder } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: 'No game state found.' });
      return;
    }
    if (!st.players[userId]) {
      client.emit('error', { message: 'Invalid user or room.' });
      return;
    }
    const pState = st.players[userId];
    const oldArr = [...pState.finalHand];

    // 검증
    if (newOrder.length !== oldArr.length) {
      client.emit('error', { message: 'newOrder length mismatch.' });
      return;
    }
    for (const c of newOrder) {
      if (!oldArr.some((o) => o.color === c.color && o.num === c.num)) {
        client.emit('error', { message: 'newOrder has invalid card.' });
        return;
      }
    }
    // 검정<흰
    for (let i = 0; i < newOrder.length - 1; i++) {
      if (
        newOrder[i].num !== -1 &&
        newOrder[i + 1].num !== -1 &&
        newOrder[i].num === newOrder[i + 1].num &&
        newOrder[i].color === 'white' &&
        newOrder[i + 1].color === 'black'
      ) {
        client.emit('error', { message: '동일 숫자는 black < white.' });
        return;
      }
    }

    pState.finalHand = newOrder;
    await this.saveGameState(roomId, st);

    const sockId = this.userSockets.get(userId);
    if (sockId) {
      this.server.to(sockId).emit('newlyDrawnArrangementDone', {
        message: '새로 뽑은 카드 수동 배치 완료.',
        finalHand: newOrder,
      });
    }

    // 상대방 알림
    const newly = this.gameService.findNewlyAdded(oldArr, newOrder);
    if (newly) {
      const idx = newOrder.findIndex(
        (x) => x.color === newly.color && x.num === newly.num,
      );
      this.broadcastNewCardPosition(roomId, userId, newly, idx);
    }
  }

  // ─────────────────────────────────────────
  // (6) endTurn
  // ─────────────────────────────────────────
  @SubscribeMessage('endTurn')
  async handleEndTurn(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) return;

    if (st.turn !== userId) {
      client.emit('error', { message: 'Not your turn to end.' });
      return;
    }

    const players = Object.keys(st.players).map(Number);
    const next = players.find((p) => p !== userId) || userId;
    st.turn = next;

    await this.saveGameState(roomId, st);
    this.server.to(roomId.toString()).emit('turnStarted', {
      turnUserId: next,
      message: `Now it's user ${next}'s turn.`,
    });
  }

  // ─────────────────────────────────────────
  // 내부 메서드
  // ─────────────────────────────────────────
  private async getGameState(roomId: number) {
    return await this.gameService.getGameState(roomId);
  }
  private async saveGameState(roomId: number, state: GameState) {
    await this.gameService.saveGameState(roomId, state);
  }

  private async checkAndRevealColorArrays(roomId: number) {
    const st = await this.getGameState(roomId);
    if (!st) return;
    if (st.alreadyRevealed) return;

    const players = Object.keys(st.players);
    if (players.length !== 2) return;
    const [p1, p2] = players;

    const p1Done = st.players[p1].arrangementDone;
    const p2Done = st.players[p2].arrangementDone;
    if (!p1Done || !p2Done) return;

    st.alreadyRevealed = true;
    await this.saveGameState(roomId, st);

    const arr1 = st.players[p1].finalHand.map((c) => c.color);
    const arr2 = st.players[p2].finalHand.map((c) => c.color);

    const s1 = this.userSockets.get(Number(p1));
    if (s1) {
      this.server.to(s1).emit('opponentColorArrayRevealed', {
        message: '상대방 색상 배열 공개 (numbers hidden).',
        opponentColorArray: arr2,
      });
    }
    const s2 = this.userSockets.get(Number(p2));
    if (s2) {
      this.server.to(s2).emit('opponentColorArrayRevealed', {
        message: '상대방 색상 배열 공개 (numbers hidden).',
        opponentColorArray: arr1,
      });
    }
  }

  private broadcastNewCardPosition(
    roomId: number,
    drawerId: number,
    card: { color: string; num: number },
    index: number,
  ) {
    const drawerSocket = this.userSockets.get(drawerId);

    (async () => {
      const st = await this.getGameState(roomId);
      if (!st) return;

      const arr = st.players[drawerId].finalHand.map((x) => x.color);
      this.server
        .to(roomId.toString())
        .except(drawerSocket)
        .emit('opponentNewCardRevealed', {
          userId: drawerId,
          color: card.color,
          index,
          message: `User ${drawerId} placed ${card.color} at index=${index}`,
          drawerColorArray: arr,
        });
    })();
  }
}
