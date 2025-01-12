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
import { UserService } from 'src/user/user.service';

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
    private readonly userService: UserService,
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
    const userNickname = await this.gameService.getUserNickname(userId);
    if (!userNickname) {
      client.emit('error', { message: 'User not found.' });
      return;
    }
    const inRoom = await this.gameRoomService.isUserInRoom(userId, roomId);
    if (!inRoom) {
      await this.gameRoomService.joinRoom(roomId, userId);
    }
    client.join(roomId.toString());
    this.server.to(roomId.toString()).emit('join', {
      sender: 'System',
      userNickname,
      message: `${userNickname}유저가 게임방에 입장했습니다.`, // TODO userNickname 추가: userNickname DB와 연결해서 가져오기
    });
  }

  @SubscribeMessage('leaveRoom')
  async handleLeaveRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;
    const userNickname = await this.gameService.getUserNickname(userId);
    if (!userNickname) {
      client.emit('error', { message: 'User not found.' });
      return;
    }
    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('leave', {
        sender: 'System',
        userNickname,
        message: `${userId}유저가 게임방을 나갔습니다.`, // TODO userNickname 추가: userNickname DB와 연결해서 가져오기
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
    const userNickname = await this.gameService.getUserNickname(userId);
    if (!userNickname) {
      client.emit('error', { message: 'User not found.' });
      return;
    }

    const inRoom = await this.gameRoomService.isUserInRoom(userId, roomId);
    if (!inRoom) {
      client.emit('error', { message: 'You are not in this room.' });
      return;
    }
    this.server
      .to(roomId.toString())
      .emit('message', { sender: userNickname, message });
  }

  // ─────────────────────────────────────────
  // (1) setReady
  // ─────────────────────────────────────────
  @SubscribeMessage('setReady')
  async handleSetReady(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    await this.redisService.set(`room:${roomId}:user:${userId}:ready`, 'true');

    this.server.to(roomId.toString()).emit('ready', { userId, ready: true });

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
        nowDraw: null,
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

    //& 첫번째 게임 유저
    this.server.to(roomId.toString()).emit('gameStart', {
      starterUserId: firstPlayerId,
      message: `게임을 시작합니다. 첫번째 턴은 ${firstPlayerId}의 시작입니다.`,
    });
  }

  // ─────────────────────────────────────────
  // (2) chooseInitialCards
  // ─────────────────────────────────────────
  @SubscribeMessage('initialCards')
  async handleChooseInitialCards(
    client: Socket,
    payload: { roomId: number; blackCount: number; whiteCount: number },
  ) {
    const { roomId, blackCount, whiteCount } = payload;
    const userId = client.data.userId;

    // 카드 합이 4인지 검증
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

    // 사용자의 카드 선택 저장
    st.players[userId].blackCount = blackCount;
    st.players[userId].whiteCount = whiteCount;

    await this.saveGameState(roomId, st);

    // 모든 사용자가 초기 카드를 선택했는지 확인
    const allChosen = Object.values(st.players).every(
      (p) => p.blackCount + p.whiteCount === 4,
    );
    if (!allChosen) return;

    // 실제 카드 배분
    for (const pidStr of Object.keys(st.players)) {
      const pid = Number(pidStr);
      const pState = st.players[pid];
      const arr: { color: string; num: number }[] = [];

      // 흑 카드 배분
      for (let i = 0; i < pState.blackCount; i++) {
        const c = st.blackDeck.pop();
        if (!c) {
          client.emit('error', { message: 'No more black cards left.' });
          return;
        }
        arr.push(c);
      }

      // 백 카드 배분
      for (let i = 0; i < pState.whiteCount; i++) {
        const c = st.whiteDeck.pop();
        if (!c) {
          client.emit('error', { message: 'No more white cards left.' });
          return;
        }
        arr.push(c);
      }

      // 카드 정렬 (조커는 자동으로 뒤로 정렬되지 않음)
      arr.sort((a, b) => this.gameService.compareCard(a, b));

      pState.finalHand = arr;
      const hasJoker = arr.some((x) => x.num === -1);
      if (!hasJoker) {
        pState.arrangementDone = true;
      }
    }

    await this.saveGameState(roomId, st);

    // 각 사용자에게 최종 패 전송
    for (const pidStr of Object.keys(st.players)) {
      const pid = Number(pidStr);
      const sockId = this.userSockets.get(pid);
      if (!sockId) continue;

      const arr = st.players[pid].finalHand;

      // 조커 카드 존재 여부 확인
      const hasJoker = arr.some((x) => x.num === -1);
      let possiblePositions: number[] = [];

      if (hasJoker) {
        // 조커를 배치할 수 있는 모든 가능한 위치 계산 (1부터 n+1까지)
        const n = arr.length;
        possiblePositions = Array.from({ length: n + 1 }, (_, i) => i + 1);

        // 클라이언트에게 `handDeck` 이벤트 전송
        this.server.to(sockId).emit('arrangeCard', {
          message: `조커카드의 위치를 정해주세요.`,
          finalHand: arr,
          possiblePositions,
        });
      } else {
        this.server.to(sockId).emit('handDeck', {
          message: '당신이 뽑은 최종 카드덱입니다.',
          finalHand: arr,
        });
        const timeout = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;

        setTimeout(() => {
          this.checkAndRevealColorArrays(roomId);
        }, timeout);
      }
    }
  }

  // ─────────────────────────────────────────
  // (3) arrangeFinalHand
  // ─────────────────────────────────────────
  @SubscribeMessage('arrangeDeck')
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
      this.server.to(sockId).emit('handDeck', {
        message: '정렬이 업데이트 됐습니다.',
        finalHand: newOrder,
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

    // 카드 뽑기
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

    // **조커 카드 처리**
    if (card.num === -1) {
      const possiblePositions = this.gameService.computeAllInsertPositions(
        pState.finalHand,
      );
      // 방금뽑은 카드 기억
      st.players[userId].nowDraw = card;
      this.saveGameState(roomId, st);

      const sockId = this.userSockets.get(userId);
      if (sockId) {
        this.server.to(sockId).emit('drawCard', {
          message: `${card.color} / ${card.num}를 뽑았습니다. 삽입 가능한 위치를 정해주세요`,
          possiblePositions, // 삽입 가능 위치 전달
          currentHand: pState.finalHand,
          newlyDrawn: card,
          arrangeCard: true,
        });
      }
      return;
    }

    // **일반 카드 처리**
    const possiblePositions = this.gameService.computeInsertPositionForCard(
      pState.finalHand,
      card,
    );

    if (possiblePositions.length === 1) {
      pState.finalHand.splice(possiblePositions[0], 0, card);
      await this.saveGameState(roomId, st);

      const sockId = this.userSockets.get(userId);
      if (sockId) {
        this.server.to(sockId).emit('drawCard', {
          message: `${card.color} / ${card.num}를 뽑았습니다. 자동으로 정렬되었습니다.`,
          finalHand: pState.finalHand,
          newPosition: possiblePositions[0],
          newlyDrawn: card,
          arrangeCard: false,
        });
      }
      const timeout = Math.floor(Math.random() * (10000 - 5000 + 1)) + 5000;

      console.log('broadCast', card);
      setTimeout(() => {
        // this.checkAndRevealColorArrays(roomId);
        this.broadcastNewCardPosition(
          roomId,
          userId,
          card,
          possiblePositions[0],
        );
      }, timeout);
    } else {
      // 선택 가능한 위치가 여러 개인 경우
      const sockId = this.userSockets.get(userId);
      //방금 뽑은 카드 기억
      st.players[userId].nowDraw = card;
      this.saveGameState(roomId, st);

      if (sockId) {
        this.server.to(sockId).emit('drawCard', {
          message: `${card.color} / ${card.num}를 뽑았습니다. 삽입 가능한 위치를 정해주세요`,
          possiblePositions, // 삽입 가능 위치 전달
          currentHand: pState.finalHand,
          newlyDrawn: card,
          arrangeCard: true,
        });
      }
    }
  }

  // ─────────────────────────────────────────
  // (5) 새 카드 수동 배치
  // ─────────────────────────────────────────
  @SubscribeMessage('arrangeNewCard')
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
    const oldArr = [...pState.finalHand, pState.nowDraw];
    const lastArr = [...pState.finalHand];
    console.log(oldArr);

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
    st.players[userId].nowDraw = null;
    await this.saveGameState(roomId, st);

    const sockId = this.userSockets.get(userId);
    if (sockId) {
      this.server.to(sockId).emit('newlyDrawnArrangementDone', {
        message: '새로 뽑은 카드 수동 배치 완료.',
        finalHand: newOrder,
      });
    }

    // 상대방 알림
    const newly = this.gameService.findNewlyAdded(lastArr, newOrder);
    if (newly) {
      const idx = newOrder.findIndex(
        (x) => x.color === newly.color && x.num === newly.num,
      );
      console.log('broadCast', newly);

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
    const userNickname = await this.gameService.getUserNickname(userId);
    if (!userNickname) {
      client.emit('error', { message: 'User not found.' });
      return;
    }
    this.server.to(roomId.toString()).emit('nowTurn', {
      turnUserId: next,
      message: ` ${userNickname}유저의 차례입니다.`,
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
        .emit('opponentCard', {
          userId: drawerId,
          color: card.color,
          index,
          message: `${drawerId}유저가 ${card.color} 카드를 ${index + 1}번 째에 추가했습니다.`,
          opponentCard: arr,
        });
    })();
  }
}
