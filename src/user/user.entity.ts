import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  userEmail: string;

  @Column({ unique: true })
  userNickname: string;

  @Column()
  password: string;
}
