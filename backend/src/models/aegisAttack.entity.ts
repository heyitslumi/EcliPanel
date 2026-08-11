import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity()
@Index(['nodeId', 'startTs'])
export class AegisAttack {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  nodeId: number;

  @Column({ type: 'varchar', length: 64, default: '' })
  type: string;

  @Column({ type: 'varchar', length: 128, default: '' })
  method: string;

  @Column({ type: 'bigint' })
  startTs: number;

  @Column({ type: 'bigint', nullable: true })
  endTs: number | null;

  @Column({ type: 'int', default: 0 })
  durationSec: number;

  @Column({ type: 'bigint', default: 0 })
  peakDropPps: number;

  @Column({ type: 'bigint', default: 0 })
  peakDropBps: number;

  @Column({ type: 'double precision', default: 0 })
  avgDropPps: number;

  @Column({ type: 'double precision', default: 0 })
  avgDropBps: number;

  @Column({ type: 'bigint', default: 0 })
  peakNetPps: number;

  @Column({ type: 'int', default: 0 })
  samples: number;
}