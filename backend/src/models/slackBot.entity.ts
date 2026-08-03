import { Entity, PrimaryGeneratedColumn, ManyToOne, Column, CreateDateColumn, UpdateDateColumn, BeforeInsert, BeforeUpdate, AfterLoad, AfterInsert, AfterUpdate } from 'typeorm';
import { User } from './user.entity';

@Entity()
export class SlackBot {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, u => u.id, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  name: string;

  @Column({ type: 'text' })
  botToken: string;

  @Column({ type: 'text' })
  appToken: string;

  @Column({ type: 'text', nullable: true })
  signingSecret?: string;

  @Column({ nullable: true })
  workspaceId?: string;

  @Column({ nullable: true })
  workspaceName?: string;

  @Column({ nullable: true })
  botUserId?: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  @AfterLoad()
  afterLoadDecrypt() {
    try {
      const { decrypt, isEncryptedString } = require('../utils/crypto');
      if (this.botToken && isEncryptedString(this.botToken)) this.botToken = decrypt(this.botToken);
      if (this.appToken && isEncryptedString(this.appToken)) this.appToken = decrypt(this.appToken);
      if (this.signingSecret && isEncryptedString(this.signingSecret)) this.signingSecret = decrypt(this.signingSecret);
    } catch (e) { /* thats bad */ }
  }

  @BeforeInsert()
  @BeforeUpdate()
  encryptFieldsBeforeSave() {
    try {
      const { encrypt, isEncryptedString } = require('../utils/crypto');
      const isEnc = (v: any) => isEncryptedString(v);
      if (this.botToken && !isEnc(this.botToken)) this.botToken = encrypt(this.botToken);
      if (this.appToken && !isEnc(this.appToken)) this.appToken = encrypt(this.appToken);
      if (this.signingSecret && !isEnc(this.signingSecret)) this.signingSecret = encrypt(this.signingSecret);
    } catch (e) { /* very bad tho */ }
  }

  @AfterInsert()
  @AfterUpdate()
  decryptFieldsAfterSave() {
    this.afterLoadDecrypt();
  }
}