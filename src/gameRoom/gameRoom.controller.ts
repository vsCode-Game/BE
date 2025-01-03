// gameRoom.controller.ts
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { GameRoomService } from './gameRoom.service';
import { RedisAuthGuard } from 'src/auth/auth.guard';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';

// DTO import
import { CreateGameRoomDto } from './dto/createGameRoom.dto';
import { CreateRoomResponseDto } from './dto/createRoomResponse';
import { GameRoomUserDto } from './dto/gameRoomUser.dto';
import { GetRoomStatusResponseDto } from './dto/getRoomStatusRespose.dto';

@ApiTags('gameRoom')
@Controller('gameRoom')
export class GameRoomController {
  constructor(private readonly gameRoomService: GameRoomService) {}

  @Get('all')
  @ApiOperation({ summary: '전체 방 리스트 조회' })
  @ApiResponse({
    status: 200,
    description: '전체 방 리스트를 배열 형태로 반환',
    schema: {
      example: [
        {
          id: 1,
          roomName: '테스트방1',
          maxPlayers: 2,
          currentCount: 1,
          createdAt: '2025-01-02T10:00:00.000Z',
        },
        {
          id: 2,
          roomName: '테스트방2',
          maxPlayers: 2,
          currentCount: 2,
          createdAt: '2025-01-02T11:00:00.000Z',
        },
      ],
    },
  })
  async getAllRooms() {
    return await this.gameRoomService.getAllRooms();
  }
  @UseGuards(RedisAuthGuard) // 컨트롤러 전체에 Guard 적용
  @Post('create')
  @ApiOperation({ summary: '방 생성과 동시에 참가' })
  @ApiBody({ type: CreateGameRoomDto })
  @ApiResponse({
    status: 201,
    description:
      '방이 성공적으로 생성되고, 방에 참여한 유저 정보를 반환합니다.',
    type: CreateRoomResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: '이미 다른 방에 참여 중이거나, 기타 형식 에러',
    schema: {
      example: {
        statusCode: 400,
        message: 'User 100 is already in room 1. Please leave that room first.',
      },
    },
  })
  async createRoom(@Body() body: CreateGameRoomDto, @Req() req: any) {
    try {
      const userId = req.user.userId; // JWT에서 추출한 userId
      return await this.gameRoomService.createRoom(body.roomName, userId);
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  @UseGuards(RedisAuthGuard) // 컨트롤러 전체에 Guard 적용
  @Post('join/:roomId')
  @ApiOperation({ summary: '방 참가' })
  @ApiParam({ name: 'roomId', type: Number, description: '참가할 게임 방 ID' })
  @ApiResponse({
    status: 201,
    description:
      '해당 방에 정상적으로 참가했다면, GameRoomUser 정보를 반환합니다.',
    type: GameRoomUserDto,
  })
  @ApiResponse({
    status: 400,
    description:
      '이미 다른 방에 참여 중이거나, 방이 꽉 찼거나, 이미 같은 방에 참가 중',
    schema: {
      example: {
        statusCode: 400,
        message: 'Room is full',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '방을 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: 'Room not found',
      },
    },
  })
  async joinRoom(@Param('roomId') roomId: number, @Req() req: any) {
    try {
      const userId = req.user.userId; // JWT에서 추출한 userId
      return await this.gameRoomService.joinRoom(roomId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException(error.message);
    }
  }

  @UseGuards(RedisAuthGuard) // 컨트롤러 전체에 Guard 적용
  @Delete('leave/:roomId')
  @ApiOperation({ summary: '방 나가기' })
  @ApiParam({ name: 'roomId', type: Number, description: '나갈 게임 방 ID' })
  @ApiResponse({
    status: 200,
    description: '방에서 정상적으로 나갔을 경우 메시지를 반환합니다.',
    schema: {
      example: {
        message: 'User 100 left room 1',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '유저가 방에 없거나 기타 오류',
    schema: {
      example: {
        statusCode: 400,
        message: 'User not in the room',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: '방을 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: 'Room not found',
      },
    },
  })
  async leaveRoom(@Param('roomId') roomId: number, @Req() req: any) {
    try {
      const userId = req.user.userId; // JWT에서 추출한 userId
      return await this.gameRoomService.leaveRoom(roomId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw new BadRequestException(error.message);
    }
  }

  @Get(':roomId')
  @ApiOperation({ summary: '방 상태 조회' })
  @ApiParam({ name: 'roomId', type: Number, description: '조회할 게임 방 ID' })
  @ApiResponse({
    status: 200,
    description: '해당 방과 방에 속한 유저 목록을 반환합니다.',
    type: GetRoomStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: '방을 찾을 수 없음',
    schema: {
      example: {
        statusCode: 404,
        message: 'Room not found',
      },
    },
  })
  async getRoomStatus(@Param('roomId') roomId: number) {
    try {
      return await this.gameRoomService.getRoomStatus(roomId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
