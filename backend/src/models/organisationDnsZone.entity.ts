import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Organisation } from './organisation.entity';

@Entity()
export class OrganisationDnsZone {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Organisation, org => org.id, { onDelete: 'CASCADE' })
  organisation: Organisation;

  @Index()
  @Column()
  organisationId: number;

  @Index({ unique: true })
  @Column()
  name: string;

  @Column({ default: 'cloudflare' })
  kind: string;

  @Column({ default: 'active' })
  status: string;

  @Column({ nullable: true, type: 'text' })
  cloudflareToken?: string;

  @Column({ nullable: true })
  externalZoneId?: string;

  @CreateDateColumn()
  createdAt: Date;
}
