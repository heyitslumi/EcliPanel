DELETE m1 FROM mail_message m1
JOIN mail_message m2
  ON m1.userId = m2.userId AND m1.messageId = m2.messageId AND m1.id > m2.id
WHERE m1.messageId IS NOT NULL;

CREATE UNIQUE INDEX IDX_mail_message_user_message ON mail_message (userId, messageId);

ALTER TABLE mail_message MODIFY body LONGTEXT NOT NULL;
ALTER TABLE mail_message MODIFY html LONGTEXT NULL;
ALTER TABLE mail_message MODIFY headers LONGTEXT NULL;
ALTER TABLE mail_message MODIFY rawHeaders LONGTEXT NULL;