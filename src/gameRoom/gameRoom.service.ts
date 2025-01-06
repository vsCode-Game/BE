import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GameRoom } from './entities/gameRoom.entity';
import { GameRoomUser } from './entities/gameRoomUser.entity';

@Injectable()
export class GameRoomService {
  constructor(
    @InjectRepository(GameRoom)
    private readonly gameRoomRepository: Repository<GameRoom>,
    @InjectRepository(GameRoomUser)
    private readonly gameRoomUserRepository: Repository<GameRoomUser>,
  ) {}

  // ─────────────────────────────────────────
  // 방 리스트 조회
  // ─────────────────────────────────────────
  async getAllRooms(): Promise<GameRoom[]> {
    return this.gameRoomRepository.find();
  }

  // ─────────────────────────────────────────
  // 방 생성 + 생성자 자동 참가
  // ─────────────────────────────────────────
  async createRoom(roomName: string, userId: number) {
    // 1. 유저가 이미 어떤 방에 속해 있는지 확인
    const existingMembership = await this.gameRoomUserRepository.findOne({
      where: { userId },
    });
    if (existingMembership) {
      throw new BadRequestException(
        `User ${userId} is already in room ${existingMembership.roomId}. Please leave that room first.`,
      );
    }

    // 2. 방 생성 (currentCount는 일단 0으로 초기화)
    const newRoom = this.gameRoomRepository.create({
      roomName,
      maxPlayers: 2, // 기본값
      currentCount: 0,
    });
    const room = await this.gameRoomRepository.save(newRoom);

    // 3. 만든 사람을 해당 방에 등록 (자동 참가)
    const newUser = this.gameRoomUserRepository.create({
      roomId: room.id,
      userId,
    });
    await this.gameRoomUserRepository.save(newUser);

    // 4. 현재 인원 수를 DB에서 다시 COUNT(*) 하여 갱신
    const count = await this.gameRoomUserRepository.count({
      where: { roomId: room.id },
    });
    room.currentCount = count;
    await this.gameRoomRepository.save(room);

    return { room };
  }

  // ─────────────────────────────────────────
  // 방 참가
  // ─────────────────────────────────────────

  async joinRoom(roomId: number, userId: number) {
    // 1. 유저가 이미 다른 방에 속해 있는지 확인
    const existingMembership = await this.gameRoomUserRepository.findOne({
      where: { userId },
    });
    if (existingMembership) {
      if (existingMembership.roomId !== roomId) {
        throw new BadRequestException(
          `User ${userId} is already in a different room (${existingMembership.roomId}). Leave that room first.`,
        );
      }
      // 같다면 에러를 던지지 않고, 기존 membership을 그대로 반환
      return existingMembership;
    }

    // 2. 방 존재 여부와 정원 확인
    const room = await this.gameRoomRepository.findOne({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }
    const currentCount = await this.gameRoomUserRepository.count({
      where: { roomId },
    });
    if (currentCount >= room.maxPlayers) {
      throw new BadRequestException('Room is full');
    }

    // 3. DB에 유저 등록
    const newUser = this.gameRoomUserRepository.create({ roomId, userId });
    await this.gameRoomUserRepository.save(newUser);

    // 4. currentCount를 DB에서 다시 조회하여 갱신
    const newCount = await this.gameRoomUserRepository.count({
      where: { roomId },
    });
    room.currentCount = newCount;
    await this.gameRoomRepository.save(room);

    return newUser;
  }

  // ─────────────────────────────────────────
  // 방에서 나가기
  // ─────────────────────────────────────────
  async leaveRoom(roomId: number, userId: number) {
    // 1. 방 확인
    const room = await this.gameRoomRepository.findOne({
      where: { id: roomId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // 2. 유저가 실제 이 방에 들어있는지 확인
    const user = await this.gameRoomUserRepository.findOne({
      where: { roomId, userId },
    });
    if (!user) {
      throw new BadRequestException('User not in the room');
    }

    // 3. 유저를 gameRoomUser 테이블에서 제거
    await this.gameRoomUserRepository.remove(user);

    // 4. 남은 인원 수를 다시 계산
    const newCount = await this.gameRoomUserRepository.count({
      where: { roomId },
    });

    // 5. 아무도 없으면 방 삭제, 있으면 currentCount 갱신
    if (newCount === 0) {
      await this.gameRoomRepository.remove(room);
      return {
        message: `User ${userId} left room ${roomId}. Room has been deleted as it's empty.`,
      };
    } else {
      room.currentCount = newCount;
      await this.gameRoomRepository.save(room);
      return { message: `User ${userId} left room ${roomId}` };
    }
  }

  // ─────────────────────────────────────────
  // 방 상태 조회
  // ─────────────────────────────────────────
  async getRoomStatus(roomId: number) {
    const room = await this.gameRoomRepository.findOne({
      where: { id: roomId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // DB에서 인원 목록 조회
    const users = await this.gameRoomUserRepository.find({ where: { roomId } });

    // (선택) 혹시 최신 인원수를 다시 덮어씌우고 싶다면:
    // const count = await this.gameRoomUserRepository.count({ where: { roomId } });
    // room.currentCount = count;
    // await this.gameRoomRepository.save(room);

    return { room, users };
  }

  // ─────────────────────────────────────────
  // 기타 유틸
  // ─────────────────────────────────────────
  async isUserInRoom(userId: number, roomId: number): Promise<boolean> {
    const user = await this.gameRoomUserRepository.findOne({
      where: { roomId, userId },
    });
    return !!user;
  }

  async getRoomIdByClient(userId: string): Promise<number | null> {
    const user = await this.gameRoomUserRepository.findOne({
      where: { userId: +userId },
    });
    return user ? user.roomId : null;
  }
}
