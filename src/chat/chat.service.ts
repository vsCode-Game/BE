// import {
//   Injectable,
//   NotFoundException,
//   BadRequestException,
// } from '@nestjs/common';
// import { GameRoom } from './entities/gameRoom.entity';
// import { GameRoomUser } from './entities/gameRoomUser.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

// @Injectable()
// export class GameRoomService {
//   constructor(
//     @InjectRepository(GameRoom)
//     private readonly gameRoomRepository: Repository<GameRoom>,
//     @InjectRepository(GameRoomUser)
//     private readonly gameRoomUserRepository: Repository<GameRoomUser>,
//   ) {}

//   async joinRoom(roomId: number, userId: number) {
//     const room = await this.gameRoomRepository.findOne({
//       where: { id: roomId },
//     });
//     if (!room) {
//       throw new NotFoundException('Room not found');
//     }

//     const existingMembership = await this.gameRoomUserRepository.findOne({
//       where: { userId },
//     });
//     if (existingMembership) {
//       throw new BadRequestException('User already in a room');
//     }

//     if (room.currentCount >= room.maxPlayers) {
//       throw new BadRequestException('Room is full');
//     }

//     const newUser = this.gameRoomUserRepository.create({ roomId, userId });
//     room.currentCount += 1;
//     await this.gameRoomRepository.save(room);
//     await this.gameRoomUserRepository.save(newUser);
//   }

//   async leaveRoom(roomId: number, userId: number) {
//     const room = await this.gameRoomRepository.findOne({
//       where: { id: roomId },
//     });
//     if (!room) {
//       throw new NotFoundException('Room not found');
//     }

//     const user = await this.gameRoomUserRepository.findOne({
//       where: { roomId, userId },
//     });
//     if (!user) {
//       throw new BadRequestException('User not in the room');
//     }

//     await this.gameRoomUserRepository.remove(user);
//     room.currentCount -= 1;
//     if (room.currentCount === 0) {
//       await this.gameRoomRepository.remove(room);
//     } else {
//       await this.gameRoomRepository.save(room);
//     }
//   }

//   async isUserInRoom(clientId: string, roomId: number): Promise<boolean> {
//     const user = await this.gameRoomUserRepository.findOne({
//       where: { roomId, userId: +clientId },
//     });
//     return !!user;
//   }

//   getRoomByClient(clientId: string): string | null {
//     // Placeholder for a real implementation
//     return null;
//   }

//   leaveRoomByClient(clientId: string): void {
//     // Placeholder for a real implementation
//   }
// }
