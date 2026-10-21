-- Run once against an existing CosmicDesk database before deploying the updated server.
CREATE TABLE IF NOT EXISTS ticket_attachments (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 message_id BIGINT UNSIGNED NOT NULL,
 filename VARCHAR(200) NOT NULL,
 mime_type VARCHAR(100) NOT NULL,
 file_size INT UNSIGNED NOT NULL,
 data LONGBLOB NOT NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 INDEX (message_id),
 CONSTRAINT fk_ticket_attachment_message FOREIGN KEY (message_id) REFERENCES ticket_messages(id) ON DELETE CASCADE
);
