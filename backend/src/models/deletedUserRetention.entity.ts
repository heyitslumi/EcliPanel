import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, BeforeInsert, AfterLoad } from 'typeorm';

@Entity()
export class DeletedUserRetention {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  userId: number;

  @Index()
  @Column({ nullable: true })
  deletionRequestId?: number;

  @Column()
  firstName: string;

  @Column({ nullable: true })
  middleName?: string;

  @Column()
  lastName: string;

  @Column()
  email: string;

  @Column({ default: false })
  hasBillingHistory: boolean;

  @Column('datetime')
  deletedAt: Date;

  @Index()
  @Column('datetime')
  retainUntil: Date;

  @CreateDateColumn()
  createdAt: Date;

  @BeforeInsert()
  encryptFieldsBeforeSave() {
    try {
      const { encrypt, isEncryptedString } = require('../utils/crypto');
      const isEnc = (v: any) => isEncryptedString(v);
      if (this.firstName && !isEnc(this.firstName)) {
        this.firstName = encrypt(this.firstName);
      }
      if (this.middleName && !isEnc(this.middleName)) {
        this.middleName = encrypt(this.middleName);
      }
      if (this.lastName && !isEnc(this.lastName)) {
        this.lastName = encrypt(this.lastName);
      }
      if (this.email && !isEnc(this.email)) {
        this.email = encrypt(this.email);
      }
    } catch (e) {
      // skip
    }
  }

  @AfterLoad()
  decryptFieldsAfterLoad() {
    try {
      const { decrypt, isEncryptedString } = require('../utils/crypto');
      const norm = (v: any) => (v && isEncryptedString(v) ? decrypt(v) : v);
      this.firstName = norm(this.firstName);
      this.middleName = norm(this.middleName);
      this.lastName = norm(this.lastName);
      this.email = norm(this.email);
    } catch (e) {
      // skip
    }
  }
}
