// game.service.ts

import { Injectable } from '@nestjs/common';
import { RedisService } from 'src/redis/redis.service';
import { GameRoomService } from 'src/gameRoom/gameRoom.service';
import { UserService } from 'src/user/user.service';

/**
 * 플레이어 상태
 * - finalHand: 유저가 가진 카드 배열
 * - arrangementDone: 조커 재배치 완료 여부
 * - blackCount, whiteCount: 처음에 뽑을 흑/백 카드 수
 */
export interface PlayerState {
  finalHand: ICard[];
  arrangementDone: boolean;
  blackCount: number;
  whiteCount: number;
  nowDraw: ICard | null;
}

export interface ICard {
  color: string;
  num: number;
}

/**
 * 전체 게임 상태
 * - turn: 현재 턴 유저 ID
 * - alreadyRevealed: 색상 배열 공개 여부
 * - players: userId -> PlayerState
 * - blackDeck, whiteDeck: 남은 흑/백 덱
 */
export interface GameState {
  status: string;
  turn: number;
  alreadyRevealed: boolean;
  players: {
    [userId: number]: PlayerState;
  };
  blackDeck: ICard[];
  whiteDeck: ICard[];
}

@Injectable()
export class GameService {
  constructor(
    private readonly redisService: RedisService,
    private readonly gameRoomService: GameRoomService,
    private readonly userService: UserService,
  ) {}

  async getUserNickname(userId: number): Promise<string> {
    const user = await this.userService.findUserById(userId);
    return user ? user.userNickname : 'Unknown';
  }

  /**
   * 방의 모든 유저가 레디했는지
   */
  async checkAllPlayersReady(roomId: number): Promise<boolean> {
    const players = await this.gameRoomService.getPlayersInRoom(roomId);
    for (const pid of players) {
      const val = await this.redisService.get(
        `room:${roomId}:user:${pid}:ready`,
      );
      if (val !== 'true') return false;
    }
    return true;
  }

  /**
   * Redis에서 gameState 로딩
   */
  async getGameState(roomId: number): Promise<GameState | null> {
    const raw = await this.redisService.get(`room:${roomId}:gameState`);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Redis에 gameState 저장
   */
  async saveGameState(roomId: number, state: GameState): Promise<void> {
    const str = JSON.stringify(state);
    await this.redisService.set(`room:${roomId}:gameState`, str);
  }

  /**
   * 덱 셔플
   */
  shuffle(deck: { color: string; num: number }[]) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  /**
   * 카드 비교 (조커(-1)는 뒤, 숫자 같으면 black < white)
   */
  compareCard(
    a: { color: string; num: number },
    b: { color: string; num: number },
  ): number {
    if (a.num === -1 && b.num !== -1) return 1; // a 조커 -> 뒤
    if (b.num === -1 && a.num !== -1) return -1; // b 조커 -> 뒤
    if (a.num === b.num && a.num !== -1) {
      // 동숫자
      if (a.color === 'black' && b.color === 'white') return -1;
      if (a.color === 'white' && b.color === 'black') return 1;
      return 0;
    }
    return a.num - b.num;
  }

  /**
   * 해당 finalHand에 조커가 있는지 여부
   */
  hasJoker(finalHand: { color: string; num: number }[]): boolean {
    return finalHand.some((c) => c.num === -1);
  }

  /**
   * 특정 finalHand에서 조커의 index를 찾고,
   * 조커의 양옆 카드 숫자를 기준으로 "근접 범위" 계산
   * 예: [백1, 백조커, 검4]
   *  => 조커인덱스=1, left.num=1, right.num=4
   *  => nearRange = {2,3} (또는 조커(-1))
   */
  private computeJokerRange(
    finalHand: { color: string; num: number }[],
  ): Set<number> {
    // 현재 예시: 조커가 한 장 있다고 가정 (여러 장이면 더 복잡해짐)
    const s = new Set<number>();
    const idx = finalHand.findIndex((c) => c.num === -1);
    if (idx < 0) return s; // 조커 없음 => 빈 set

    const leftCard = finalHand[idx - 1];
    const rightCard = finalHand[idx + 1];
    if (!leftCard || !rightCard) {
      // 조커가 맨앞 혹은 맨뒤인 경우,
      // 여기선 예시로 leftCard 없으면 => nearRange = 0..(rightNum-1)
      // etc. 편의상 예시:
      // 만약 left없고 rightCard.num=4 => nearRange = { -1, 0,1,2,3 }
      // (원하는대로 정교화)
      if (!leftCard && rightCard) {
        for (let x = -1; x < rightCard.num; x++) {
          s.add(x);
        }
      } else if (!rightCard && leftCard) {
        for (let x = leftCard.num + 1; x <= 11; x++) {
          s.add(x);
        }
        s.add(-1); // 조커
      }
      return s;
    }

    // 일반 케이스: left.num = L, right.num= R
    // nearRange = (L+1 .. R-1) ∪ {-1}
    const L = leftCard.num;
    const R = rightCard.num;

    // 조커도 near
    s.add(-1);

    if (L < R) {
      // 범위 (L+1) ~ (R-1)
      for (let v = L + 1; v < R; v++) {
        s.add(v);
      }
    }
    return s;
  }

  /**
   * "조커 양옆 범위" 판별:
   *  - computeJokerRange()로 구한 집합에 newCard.num이 있으면 => true
   */
  isNearJokerRange(
    finalHand: { color: string; num: number }[],
    newCard: { color: string; num: number },
  ): boolean {
    if (!this.hasJoker(finalHand)) return false;
    const nearSet = this.computeJokerRange(finalHand);
    return nearSet.has(newCard.num);
  }

  /**
   * oldArr vs newArr => 새로 들어온 카드 찾기
   */
  findNewlyAdded(
    oldArr: { color: string; num: number }[],
    newArr: { color: string; num: number }[],
  ): { color: string; num: number } | null {
    for (const c of newArr) {
      if (!oldArr.some((x) => x.color === c.color && x.num === c.num)) {
        return c;
      }
    }
    return null;
  }

  insertCardInOrder(
    finalHand: { color: string; num: number }[],
    card: { color: string; num: number },
  ): { color: string; num: number }[] {
    const newHand = [...finalHand];
    let insertIndex = 0;

    for (let i = 0; i < newHand.length; i++) {
      if (newHand[i].num === -1) {
        // 조커는 건너뜀
        insertIndex = i + 1;
        continue;
      }
      if (this.compareCard(card, newHand[i]) < 0) {
        insertIndex = i;
        break;
      } else {
        insertIndex = i + 1;
      }
    }

    newHand.splice(insertIndex, 0, card);
    return newHand;
  }

  validateNewOrder(
    oldArr: { color: string; num: number }[],
    newOrder: { color: string; num: number }[],
  ): boolean {
    if (oldArr.length !== newOrder.length) return false;

    const oldSet = new Set(oldArr.map((c) => `${c.color}-${c.num}`));
    const newSet = new Set(newOrder.map((c) => `${c.color}-${c.num}`));

    return [...oldSet].every((key) => newSet.has(key));
  }
  computeAllInsertPositions(
    finalHand: { color: string; num: number }[],
  ): number[] {
    const positions = [];
    for (let i = 0; i <= finalHand.length; i++) {
      positions.push(i); // 각 카드의 양옆 포함
    }
    return positions;
  }
  computeInsertPositionForCard(
    finalHand: { color: string; num: number }[],
    newCard: { color: string; num: number },
  ): number[] {
    const positions: number[] = [];
    const jokerIndices: number[] = [];

    // Step 1: Adjust white cards by adding 0.5 to their numbers
    const adjustedHand = finalHand.map((card) => {
      if (card.color === 'white' && card.num !== -1) {
        return { ...card, num: card.num + 0.5 };
      }
      return card;
    });
    const adjustedCard =
      newCard.color === 'white'
        ? { ...newCard, num: newCard.num + 0.5 }
        : newCard;

    // Step 2: Find all joker indices
    adjustedHand.forEach((card, index) => {
      if (card.num === -1) {
        jokerIndices.push(index);
      }
    });

    // Step 3: Find joker runs (consecutive jokers)
    const jokerRuns: { start: number; end: number }[] = [];
    let runStart: number | null = null;

    jokerIndices.forEach((index, i) => {
      if (runStart === null) {
        runStart = index;
      }
      // If it's the last joker or the next joker is not consecutive
      if (i === jokerIndices.length - 1 || jokerIndices[i + 1] !== index + 1) {
        jokerRuns.push({ start: runStart, end: index });
        runStart = null;
      }
    });

    // Step 4: For each run, find leftNum and rightNum
    const jokerRanges: {
      leftNum: number | null;
      rightNum: number | null;
      run: { start: number; end: number };
    }[] = [];

    jokerRuns.forEach((run) => {
      const leftIndex = run.start - 1;
      const rightIndex = run.end + 1;

      const leftNum = leftIndex >= 0 ? adjustedHand[leftIndex].num : null;
      const rightNum =
        rightIndex < adjustedHand.length ? adjustedHand[rightIndex].num : null;

      jokerRanges.push({
        leftNum: leftNum,
        rightNum: rightNum,
        run: run,
      });
    });

    // Step 5: For each range, if adjustedCard.num falls within, add insertion positions
    jokerRanges.forEach((range) => {
      const { leftNum, rightNum, run } = range;

      if (leftNum !== null && rightNum !== null) {
        if (adjustedCard.num >= leftNum && adjustedCard.num <= rightNum) {
          // Insert between leftNum and first joker
          const leftPosition =
            adjustedHand.findIndex((card) => card.num === leftNum) + 1;
          if (!positions.includes(leftPosition)) positions.push(leftPosition);

          // Insert between jokers
          if (run.start < run.end) {
            for (let pos = run.start + 1; pos <= run.end; pos++) {
              if (!positions.includes(pos)) positions.push(pos);
            }
          }

          // Insert between last joker and rightNum
          const rightPosition = run.end + 1;
          if (!positions.includes(rightPosition)) positions.push(rightPosition);
        }
      } else if (leftNum === null && rightNum !== null) {
        // Insert at start if adjustedCard.num <= rightNum
        if (adjustedCard.num <= rightNum) {
          positions.push(0);
          positions.push(run.start + 1);
        }
      } else if (leftNum !== null && rightNum === null) {
        // Insert at end if adjustedCard.num >= leftNum
        if (adjustedCard.num >= leftNum) {
          const endPosition = adjustedHand.length;
          positions.push(run.start);
          positions.push(endPosition);
        }
      }
    });

    // Remove duplicates and sort
    const uniquePositions = Array.from(new Set(positions)).sort(
      (a, b) => a - b,
    );

    // If influenced positions exist, return them
    if (uniquePositions.length > 0) {
      return uniquePositions;
    }

    // Step 6: If not influenced by jokers, find single insertion position based on sorting
    for (let i = 0; i <= adjustedHand.length; i++) {
      const left = adjustedHand[i - 1];
      const right = adjustedHand[i];

      if (!left && right) {
        // Insert at start
        if (adjustedCard.num < right.num) {
          positions.push(i);
          break;
        }
      } else if (!right && left) {
        // Insert at end
        if (adjustedCard.num > left.num) {
          positions.push(i);
          break;
        }
      } else if (left && right) {
        if (adjustedCard.num > left.num && adjustedCard.num < right.num) {
          positions.push(i);
          break;
        }
      }
    }

    return positions;
  }
}
