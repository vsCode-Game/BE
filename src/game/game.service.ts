// game.service.ts

import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { GameRoomService } from 'src/gameRoom/gameRoom.service';

@Injectable()
export class GameService {
  constructor(
    private readonly redisService: RedisService,
    private readonly gameRoomService: GameRoomService,
  ) {}

  // 모든 사용자가 레디했는지 확인
  async checkAllPlayersReady(roomId: number): Promise<boolean> {
    const players = await this.gameRoomService.getPlayersInRoom(roomId);
    for (const playerId of players) {
      const readyKey = `room:${roomId}:user:${playerId}:ready`;
      const isReady = await this.redisService.get(readyKey);
      if (isReady !== 'true') {
        return false;
      }
    }
    return true;
  }

  // (1) 흑/백 각각 0~11 + 조커(-1) → 13장씩
  // (2) blackCount, whiteCount만큼 무작위 발급
  // (3) 기본 정렬 (숫자 ascending, 같은 숫자면 black < white)
  async assignRandomCards(roomId: number, gameState: any) {
    // 흑 카드 풀
    const blackDeck = Array.from({ length: 12 }, (_, i) => ({
      color: 'black',
      num: i,
    }));
    blackDeck.push({ color: 'black', num: -1 }); // 흑조커

    // 백 카드 풀
    const whiteDeck = Array.from({ length: 12 }, (_, i) => ({
      color: 'white',
      num: i,
    }));
    whiteDeck.push({ color: 'white', num: -1 }); // 백조커

    // 셔플
    this.shuffle(blackDeck);
    this.shuffle(whiteDeck);

    // color 우선순위 map
    const colorPriority = { black: 0, white: 1 };

    for (const pid of Object.keys(gameState.players)) {
      const p = gameState.players[pid];
      const { blackCount, whiteCount } = p;

      const selectedBlack = blackDeck.splice(0, blackCount);
      const selectedWhite = whiteDeck.splice(0, whiteCount);

      // 합쳐서 기본 정렬
      p.finalHand = [...selectedBlack, ...selectedWhite].sort((a, b) => {
        // -1(조커) vs 일반카드
        // → 우선 여기서는 "조커는 뒤로" 등 임시 처리를 할 수도 있지만,
        //    사용자 재배치가 필요 없으면 바로 자리를 잡아도 됨.
        //    예시는 “숫자 < 조커” 로 놓아도 괜찮습니다.
        if (a.num === -1 && b.num !== -1) return 1; // 조커 뒤
        if (b.num === -1 && a.num !== -1) return -1; // 조커 뒤
        if (a.num === b.num && a.num !== -1) {
          // 숫자 동일 & 둘 다 조커가 아닐 때 → black < white
          return colorPriority[a.color] - colorPriority[b.color];
        }
        return a.num - b.num;
      });
    }

    // Redis 갱신
    await this.redisService.set(
      `room:${roomId}:gameState`,
      JSON.stringify(gameState),
    );
  }

  // Fisher-Yates
  private shuffle(deck: any[]) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
}
