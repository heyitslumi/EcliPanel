import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index, CreateDateColumn } from 'typeorm';

@Entity()
export class Organisation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ unique: true })
  handle: string;

  @Index()
  @Column()
  ownerId: number;

  @Column({ default: 'none' })
  portalTier: string;

  @Column({ nullable: true })
  planId?: number;

  @Column({ default: 'active' })
  status: string;

  @Column({ nullable: true, type: 'datetime' })
  expiresAt?: Date;

  @Column({ default: false })
  isStaff: boolean;

  @Column({ nullable: true })
  avatarUrl?: string;

  @OneToMany(
    () => require('./organisationInvite.entity').OrganisationInvite,
    (inv: any) => inv.organisation
  )
  invites: import('./organisationInvite.entity').OrganisationInvite[];

  @OneToMany(
    () => require('./organisationMember.entity').OrganisationMember,
    (membership: any) => membership.organisation
  )
  memberships: import('./organisationMember.entity').OrganisationMember[];

  @CreateDateColumn()
  createdAt: Date;
}
