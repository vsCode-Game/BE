import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class GameRoomUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  roomId: number;

  @Column() // 필수 입력값으로 설정
  userId: number;

  @CreateDateColumn()
  joinedAt: Date;
}
