import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity()
export class GameRoom {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  roomName: string;

  @Column()
  maxPlayers: number;

  @Column({ default: 0 }) // 초기값 설정
  currentCount: number;

  @CreateDateColumn()
  createdAt: Date;
}
