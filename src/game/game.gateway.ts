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
import { GameService, GameState, ICard } from './game.service';
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

    const userNickname = await this.gameService.getUserNickname(userId);
    // if (roomId) {
    //   await this.gameRoomService.leaveRoom(roomId, userId);
    //   this.server.to(roomId.toString()).emit('message', {
    //     sender: 'System',
    //     message: `${userNickname} 유저가 퇴장했습니다.`,
    //   });
    // }
  }

  // ─────────────────────────────────────────
  // 방 입/퇴장
  // ─────────────────────────────────────────

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;
    const userNickname = await this.gameService.getUserNickname(userId);

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

    if (roomId) {
      await this.gameRoomService.leaveRoom(roomId, userId);
      this.server.to(roomId.toString()).emit('leave', {
        sender: 'System',
        userNickname,
        message: `${userNickname}유저가 게임방을 나갔습니다.`, // TODO userNickname 추가: userNickname DB와 연결해서 가져오기
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
      isFlipped: false, // 카드 초기화 시 isFlipped 설정
    }));
    blackDeck.push({ color: 'black', num: -1, isFlipped: false });

    const whiteDeck = Array.from({ length: 12 }, (_, i) => ({
      color: 'white',
      num: i,
      isFlipped: false, // 카드 초기화 시 isFlipped 설정
    }));
    whiteDeck.push({ color: 'white', num: -1, isFlipped: false });

    this.gameService.shuffle(blackDeck);
    this.gameService.shuffle(whiteDeck);

    gameState.blackDeck = blackDeck;
    gameState.whiteDeck = whiteDeck;

    await this.saveGameState(roomId, gameState);
    const firstPlayerNickname =
      await this.gameService.getUserNickname(firstPlayerId);

    //& 첫번째 게임 유저
    this.server.to(roomId.toString()).emit('gameStart', {
      starterUserId: firstPlayerNickname,
      message: `게임을 시작합니다. 첫번째 턴은 ${firstPlayerNickname}의 시작입니다.`,
    });
  }

  @SubscribeMessage('unReady')
  async handleUnReady(client: Socket, payload: { roomId: number }) {
    const { roomId } = payload;
    const userId = client.data.userId;

    await this.redisService.set(`room:${roomId}:user:${userId}:ready`, 'false');

    this.server.to(roomId.toString()).emit('ready', { userId, ready: false });
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
      const arr: ICard[] = [];
      let hasJoker = false;

      // 흑 카드 배분
      for (let i = 0; i < pState.blackCount; i++) {
        const c = st.blackDeck.pop();
        if (c.num === -1) {
          if (hasJoker) {
            const c1 = st.blackDeck.pop();
            st.blackDeck.push(c);
            arr.push(c1);
            continue;
          } else {
            hasJoker = true;
          }
        }
        arr.push(c);
      }

      // 백 카드 배분
      for (let i = 0; i < pState.whiteCount; i++) {
        const c = st.whiteDeck.pop();
        if (c.num === -1) {
          if (hasJoker) {
            const c1 = st.whiteDeck.pop();
            st.whiteDeck.push(c);
            arr.push(c1);
            continue;
          } else {
            hasJoker = true;
          }
        }
        arr.push(c);
      }

      // 카드 정렬 (조커는 자동으로 뒤로 정렬)
      arr.sort((a, b) => this.gameService.compareCard(a, b));

      pState.finalHand = arr;
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
        const jokerCard = arr.pop();
        possiblePositions = Array.from({ length: n }, (_, i) => i);

        // 클라이언트에게 `handDeck` 이벤트 전송
        this.server.to(sockId).emit('arrangeCard', {
          message: `조커카드의 위치를 정해주세요.`,
          arrangeCard: true,
          finalHand: arr,
          jokerCard,
          possiblePositions,
        });
      } else {
        this.server.to(sockId).emit('handDeck', {
          message: '당신이 뽑은 최종 카드덱입니다.',
          arrangeCard: false,
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
    payload: { roomId: number; newOrder: ICard[] },
  ) {
    const { roomId, newOrder } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: '게임방을 찾을 수 없습니다.' });
      return;
    }
    if (!st.players[userId]) {
      client.emit('error', { message: '유저가 게임방에 존재하지 않습니다.' });
      return;
    }
    const pState = st.players[userId];
    const oldArr = [...pState.finalHand];

    if (newOrder.length !== oldArr.length) {
      client.emit('error', { message: '카드덱의 카드 게수가 옳지 않습니다.' });
      return;
    }
    for (const c of newOrder) {
      if (!oldArr.some((x) => x.color === c.color && x.num === c.num)) {
        client.emit('error', {
          message: '유효하지 않은 카드가 추가되었습니다.',
        });
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
      client.emit('error', { message: '게임이 진행중이 아닙니다.' });
      return;
    }
    if (st.turn !== userId) {
      client.emit('error', { message: '당신의 차례가 아닙니다.' });
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
      client.emit('error', {
        message: `더이상  ${color} 색상의 카드가 없습니다.`,
      });
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
          message: `[${card.color}색 ${card.num}번] 카드를 뽑았습니다. 삽입 가능한 위치를 정해주세요`,
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
      pState.nowDraw = card;
      await this.saveGameState(roomId, st);

      const sockId = this.userSockets.get(userId);
      if (sockId) {
        this.server.to(sockId).emit('drawCard', {
          message: `[${card.color} 색 ${card.num}번] 카드를 뽑았습니다. 자동으로 정렬되었습니다.`,
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
          message: `[${card.color}색  ${card.num}번] 카드를 뽑았습니다. 삽입 가능한 위치를 정해주세요`,
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
    payload: { roomId: number; newOrder: ICard[] },
  ) {
    const { roomId, newOrder } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: '게임이 진행중이 아닙니다.' });
      return;
    }
    if (!st.players[userId]) {
      client.emit('error', { message: '유저가 게임방에 존재하지 않습니다.' });
      return;
    }
    const pState = st.players[userId];
    const oldArr = [...pState.finalHand, pState.nowDraw];
    const lastArr = [...pState.finalHand];
    console.log(oldArr);

    // 검증
    if (newOrder.length !== oldArr.length) {
      client.emit('error', {
        message: '새로운 카드덱 갯수가 옳바르지 않습니다.',
      });
      return;
    }
    for (const c of newOrder) {
      if (!oldArr.some((o) => o.color === c.color && o.num === c.num)) {
        client.emit('error', { message: '유효하지 않은 카드를 뽑았습니다.' });
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
    const newly = this.gameService.findNewlyAdded(lastArr, newOrder);
    if (newly) {
      const idx = newOrder.findIndex(
        (x) => x.color === newly.color && x.num === newly.num,
      );
      console.log('broadCast', newly);

      this.broadcastNewCardPosition(roomId, userId, newly, idx);
    }
  }

  // game.gateway.ts

  @SubscribeMessage('guessCard')
  async handleGuessCardNumber(
    client: Socket,
    payload: { roomId: number; cardIndex: number; cardNumber: number },
  ) {
    const { roomId, cardIndex, cardNumber } = payload;
    const userId = client.data.userId;

    const st = await this.getGameState(roomId);
    if (!st) {
      client.emit('error', { message: '게임 상태를 찾을 수 없습니다.' });
      return;
    }

    if (st.turn !== userId) {
      client.emit('error', { message: '지금은 당신의 턴이 아닙니다.' });
      return;
    }

    const players = Object.keys(st.players).map(Number);
    if (players.length !== 2) {
      client.emit('error', {
        message: '게임에 참여한 플레이어가 2명이 아닙니다.',
      });
      return;
    }

    // 상대방 식별
    const opponentId = players.find((pid) => pid !== userId);
    if (!opponentId) {
      client.emit('error', { message: '상대방을 찾을 수 없습니다.' });
      return;
    }

    const opponentState = st.players[opponentId];
    if (!opponentState) {
      client.emit('error', { message: '상대방의 상태를 찾을 수 없습니다.' });
      return;
    }

    // cardIndex 유효성 검사
    if (cardIndex < 0 || cardIndex >= opponentState.finalHand.length) {
      client.emit('error', { message: '유효하지 않은 카드 인덱스입니다.' });
      return;
    }

    const actualCard = opponentState.finalHand[cardIndex];

    const guessingUserSocketId = this.userSockets.get(userId);
    const opponentUserSocketId = this.userSockets.get(opponentId);

    if (actualCard.num === cardNumber) {
      // 맞춘 경우
      // 카드 뒤집기
      st.players[opponentId].finalHand[cardIndex].isFlipped = true;
      await this.saveGameState(roomId, st);

      // 패배 조건 확인: 상대방의 모든 카드가 뒤집어졌는지
      const opponentAllFlipped = st.players[opponentId].finalHand.every(
        (card) => card.isFlipped,
      );
      if (opponentAllFlipped) {
        // 게임 종료 처리
        await this.endGame(roomId, userId, opponentId);
        return;
      }

      // Guessing User에게 보낼 상대방의 카드 배열 가공
      const state = await this.getGameState(roomId);
      const updateOpponentHand = state.players[opponentId].finalHand;
      const cardInfo = updateOpponentHand.map((card) =>
        card.isFlipped
          ? { ...card }
          : { color: card.color, isFlipped: card.isFlipped },
      );
      const userNickname = await this.gameService.getUserNickname(userId);
      // Guessing User에게 'correctGuess' 이벤트 전송
      if (guessingUserSocketId) {
        this.server.to(guessingUserSocketId).emit('correctGuess', {
          message: `${userNickname}님이 ${opponentId}님의 카드 ${cardIndex + 1}번을 맞추셨습니다!`,
          cardIndex: cardIndex,
          cardNumber: cardNumber,
          opponentFinalHand: cardInfo,
        });
      }

      // Opponent User에게 'cardFlipped' 이벤트 전송
      if (opponentUserSocketId) {
        this.server.to(opponentUserSocketId).emit('yourCardFlipped', {
          message: `${userNickname}님이 당신의 카드 ${cardIndex + 1}번을 맞추셨습니다!`,
          cardIndex: cardIndex,
          cardNumber: cardNumber,
          finalHand: updateOpponentHand,
        });
      }

      // 추가 로직: 예를 들어, 점수 업데이트, 게임 종료 조건 등
      // 예시로 턴을 변경하지 않고 동일한 플레이어에게 계속 턴을 부여할 수 있습니다.
    } else {
      // 틀린 경우
      // 방금 뽑은 카드 가져오기 (가정: 마지막으로 뽑은 카드가 nowDraw에 저장됨)
      const drawnCard = st.players[userId].nowDraw;
      if (!drawnCard) {
        client.emit('error', {
          message: '최근에 뽑은 카드를 찾을 수 없습니다.',
        });
        return;
      }

      // drawnCard가 finalHand에 있는지 확인
      const cardPosition = st.players[userId].finalHand.findIndex(
        (c) =>
          c.color === drawnCard.color &&
          c.num === drawnCard.num &&
          !c.isFlipped,
      );

      if (cardPosition === -1) {
        client.emit('error', {
          message: '방금 뽑은 카드를 finalHand에서 찾을 수 없습니다.',
        });
        return;
      }

      // 해당 위치의 카드를 뒤집기
      st.players[userId].finalHand[cardPosition].isFlipped = true;
      st.players[userId].nowDraw = null; // nowDraw 초기화
      await this.saveGameState(roomId, st);

      const state = await this.getGameState(roomId);
      const updateMyHand = state.players[userId].finalHand;
      const cardInfo = updateMyHand.map((card) =>
        card.isFlipped
          ? { ...card }
          : { color: card.color, isFlipped: card.isFlipped },
      );

      // Guessing User에게 'wrongGuess' 이벤트 전송
      if (guessingUserSocketId) {
        this.server.to(guessingUserSocketId).emit('wrongGuess', {
          message: `${await this.gameService.getUserNickname(userId)}님이 틀렸습니다. 방금 뽑은 카드가 뒤집혔습니다.`,
          userId: userId,
          cardIndex: cardPosition,
          cardNumber: st.players[userId].finalHand[cardPosition].num,
          finalHand: updateMyHand,
        });
      }

      // Opponent User에게 'yourCardFlipped' 이벤트 전송
      if (opponentUserSocketId) {
        this.server.to(opponentUserSocketId).emit('cardFlipped', {
          message: `${await this.gameService.getUserNickname(userId)}님이 당신의 ${payload.cardIndex + 1}번째 카드를 ${payload.cardNumber}로 추측했고, 카드를 틀렸습니다. 상대방의 방금 뽑은 카드가 뒤집혔습니다.`,
          cardIndex: cardPosition,
          cardNumber: st.players[userId].finalHand[cardPosition].num,
          opponentFinalHand: cardInfo,
        });
      }

      // 턴 변경
      st.turn = opponentId;
      await this.saveGameState(roomId, st);

      // 모든 플레이어에게 턴 변경 알림
      const userNickname = await this.gameService.getUserNickname(userId);

      this.server.to(roomId.toString()).emit('nowTurn', {
        turnUserId: st.turn,
        fieldWhite: st.whiteDeck.length,
        fieldBlack: st.blackDeck.length,
        message: ` ${userNickname} 유저의 턴입니다.`,
      });
    }
  }

  /**
   * 게임을 종료하고 승리/패배를 처리합니다.
   * @param roomId 게임 방 ID
   * @param winnerId 승리한 유저 ID
   * @param loserId 패배한 유저 ID
   */
  private async endGame(roomId: number, winnerId: number, loserId: number) {
    // 승리 기록 저장
    await this.gameService.recordVictory(winnerId, roomId);

    // 클라이언트에게 게임 종료 알림
    const winnerSocketId = this.userSockets.get(winnerId);
    const loserSocketId = this.userSockets.get(loserId);

    const winnerNickname = await this.gameService.getUserNickname(winnerId);
    const loserNickname = await this.gameService.getUserNickname(loserId);

    if (winnerSocketId) {
      this.server.to(winnerSocketId).emit('gameOver', {
        result: 'win',
        message: `축하합니다! ${winnerNickname}님이 승리하셨습니다.`,
      });
    }

    if (loserSocketId) {
      this.server.to(loserSocketId).emit('gameOver', {
        result: 'lose',
        message: `아쉽습니다. ${loserNickname}님이 패배하셨습니다.`,
      });
    }

    // 게임 상태 정리 (Redis에서 삭제)
    await this.gameService.deleteGameState(roomId);
    await this.gameRoomService.leaveAllUsers(roomId);

    // 게임 방 정보 삭제
    await this.redisService.del(`room:${roomId}:gameState`);
    // 필요 시 다른 관련 키도 삭제
    // 예: 레디 상태 키들
    const players = await this.gameRoomService.getPlayersInRoom(roomId);
    for (const pid of players) {
      await this.redisService.del(`room:${roomId}:user:${pid}:ready`);
    }

    // 방 나가기
    const sockets = await this.server.in(roomId.toString()).fetchSockets();
    sockets.forEach((socket) => {
      socket.leave(roomId.toString());
    });

    console.log(
      `게임 방 ${roomId}이 종료되었습니다. 승리자: ${winnerNickname}, 패배자: ${loserNickname}`,
    );
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
      client.emit('error', { message: '당신은 현재 턴이 아닙니다.' });
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
      fieldWhite: st.whiteDeck.length,
      fieldBlack: st.blackDeck.length,
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

    const arr1 = st.players[p1].finalHand.map((c) => {
      return { color: c.color, isFlipped: c.isFlipped };
    });
    const arr2 = st.players[p2].finalHand.map((c) => {
      return { color: c.color, isFlipped: c.isFlipped };
    });

    const s1 = this.userSockets.get(Number(p1));
    if (s1) {
      this.server.to(s1).emit('opponentColorArrayRevealed', {
        message: '상대방 카드덱 공개.',
        opponentColorArray: arr2,
      });
    }
    const s2 = this.userSockets.get(Number(p2));
    if (s2) {
      this.server.to(s2).emit('opponentColorArrayRevealed', {
        message: '상대방 카드덱 공개.',
        opponentColorArray: arr1,
      });
    }

    const userNickname = await this.gameService.getUserNickname(st.turn);
    if (!userNickname) {
      this.server.emit('error', { message: 'User not found.' });
      return;
    }

    this.server.to(roomId.toString()).emit('nowTurn', {
      turnUserId: st.turn,
      fieldWhite: st.whiteDeck.length,
      fieldBlack: st.blackDeck.length,
      message: ` ${userNickname}유저의 차례입니다.`,
    });
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

      const arr = st.players[drawerId].finalHand.map((x) =>
        x.isFlipped ? { ...x } : { color: x.color, isFlipped: x.isFlipped },
      );
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
      this.server.to(drawerSocket).emit('guessCard', {
        message: `이제 상대방의 카드를 추측할 차례입니다!`,
      });
    })();
  }
}
