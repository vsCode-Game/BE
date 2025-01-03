// gameRoom.service.ts
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

  async getAllRooms(): Promise<GameRoom[]> {
    return this.gameRoomRepository.find();
  }

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

    // 2. 방 생성
    const newRoom = this.gameRoomRepository.create({
      roomName,
      maxPlayers: 2, // 기본값: 2명
      currentCount: 1, // 방 생성과 동시에 1명 참가
    });
    const room = await this.gameRoomRepository.save(newRoom);

    // 3. 유저를 방에 추가
    const newUser = this.gameRoomUserRepository.create({
      roomId: room.id,
      userId,
    });
    await this.gameRoomUserRepository.save(newUser);

    return { room, user: newUser };
  }

  // 방 참가
  async joinRoom(roomId: number, userId: number) {
    // 1. 유저가 이미 다른 방에 속해 있는지 확인
    //    - 이미 같은 방에 있다면 "이미 참여 중" 예외를 던지고
    //    - 다른 방에 있다면 "다른 방에 참여 중" 예외를 던짐
    const existingMembership = await this.gameRoomUserRepository.findOne({
      where: { userId },
    });
    if (existingMembership) {
      if (existingMembership.roomId === roomId) {
        throw new BadRequestException(
          `User ${userId} already joined this room.`,
        );
      } else {
        throw new BadRequestException(
          `User ${userId} is already in a different room (${existingMembership.roomId}). Leave that room first.`,
        );
      }
    }

    // 2. 방 존재 여부와 정원 확인
    const room = await this.gameRoomRepository.findOne({
      where: { id: roomId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    if (room.currentCount >= room.maxPlayers) {
      throw new BadRequestException('Room is full');
    }

    // 3. 유저를 방에 추가
    const newUser = this.gameRoomUserRepository.create({ roomId, userId });
    room.currentCount += 1;
    await this.gameRoomRepository.save(room);

    return await this.gameRoomUserRepository.save(newUser);
  }

  // 방에서 나가기
  async leaveRoom(roomId: number, userId: number) {
    const room = await this.gameRoomRepository.findOne({
      where: { id: roomId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const user = await this.gameRoomUserRepository.findOne({
      where: { roomId, userId },
    });
    if (!user) {
      throw new BadRequestException('User not in the room');
    }

    // 유저 삭제
    await this.gameRoomUserRepository.remove(user);
    room.currentCount -= 1; // 현재 인원 감소

    // 방에 더 이상 유저가 없으면 방 삭제
    if (room.currentCount === 0) {
      await this.gameRoomRepository.remove(room);
      return {
        message: `User ${userId} left room ${roomId}. Room has been deleted as it's empty.`,
      };
    }

    await this.gameRoomRepository.save(room);
    return { message: `User ${userId} left room ${roomId}` };
  }

  // 방 상태 조회
  async getRoomStatus(roomId: number) {
    const room = await this.gameRoomRepository.findOne({
      where: { id: roomId },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const users = await this.gameRoomUserRepository.find({ where: { roomId } });
    return { room, users };
  }
}
