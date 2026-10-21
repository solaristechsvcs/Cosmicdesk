CREATE TABLE IF NOT EXISTS users (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(120) NOT NULL,
 email VARCHAR(255) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 role ENUM('customer','staff','admin') NOT NULL DEFAULT 'customer',
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS departments (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(100) NOT NULL UNIQUE
);
INSERT IGNORE INTO departments (id,name) VALUES (1,'General Support'),(2,'Billing'),(3,'Technical Support');
CREATE TABLE IF NOT EXISTS tickets (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 subject VARCHAR(200) NOT NULL,
 department_id INT UNSIGNED NOT NULL,
 priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
 status ENUM('open','pending','closed') NOT NULL DEFAULT 'open',
 customer_id BIGINT UNSIGNED NULL,
 guest_name VARCHAR(120) NULL,
 guest_email VARCHAR(255) NULL,
 guest_token_hash CHAR(64) NULL,
 assigned_to BIGINT UNSIGNED NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 INDEX (customer_id), INDEX (guest_email), INDEX (status), INDEX (assigned_to),
 FOREIGN KEY (department_id) REFERENCES departments(id),
 FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL,
 FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS ticket_messages (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 ticket_id BIGINT UNSIGNED NOT NULL,
 author_id BIGINT UNSIGNED NULL,
 author_name VARCHAR(120) NOT NULL,
 body TEXT NOT NULL,
 internal_note BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
 FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_id BIGINT UNSIGNED NULL,
 action VARCHAR(100) NOT NULL,
 ticket_id BIGINT UNSIGNED NULL,
 created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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
