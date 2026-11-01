CREATE TABLE IF NOT EXISTS help_topics (
 id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(100) NOT NULL UNIQUE,
 department_id INT UNSIGNED NOT NULL,
 active BOOLEAN NOT NULL DEFAULT TRUE,
 FOREIGN KEY (department_id) REFERENCES departments(id)
);
INSERT IGNORE INTO help_topics (id,name,department_id) VALUES (1,'General question',1),(2,'Billing question',2),(3,'Technical issue',3);
ALTER TABLE tickets ADD COLUMN help_topic_id INT UNSIGNED NULL, ADD CONSTRAINT fk_ticket_topic FOREIGN KEY (help_topic_id) REFERENCES help_topics(id);
CREATE TABLE IF NOT EXISTS staff_departments (
 user_id BIGINT UNSIGNED NOT NULL,
 department_id INT UNSIGNED NOT NULL,
 PRIMARY KEY (user_id,department_id),
 FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY (department_id) REFERENCES departments(id)
);
-- Preserve existing staff visibility during upgrade.
INSERT IGNORE INTO staff_departments SELECT u.id,d.id FROM users u CROSS JOIN departments d WHERE u.role IN ('staff','admin');
CREATE TABLE IF NOT EXISTS settings (
 setting_key VARCHAR(50) PRIMARY KEY,
 setting_value VARCHAR(500) NOT NULL
);
INSERT IGNORE INTO settings VALUES ('desk_name','CosmicDesk'),('welcome_message','Customer support across the universe'),('allow_guests','1');
CREATE INDEX idx_queue ON tickets(department_id,status,updated_at);
