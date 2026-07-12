import type { Db } from '../types.js';

export function up(db: Db): void {
  // Add encrypted columns to unified_api_keys
  db.exec(`
    ALTER TABLE unified_api_keys ADD COLUMN encrypted_key TEXT;
    ALTER TABLE unified_api_keys ADD COLUMN iv TEXT;
    ALTER TABLE unified_api_keys ADD COLUMN auth_tag TEXT;
  `);

  // Add encrypted columns to fusion_api_keys
  db.exec(`
    ALTER TABLE fusion_api_keys ADD COLUMN encrypted_key TEXT;
    ALTER TABLE fusion_api_keys ADD COLUMN iv TEXT;
    ALTER TABLE fusion_api_keys ADD COLUMN auth_tag TEXT;
  `);
}

export function down(db: Db): void {
  // SQLite 3.35.0+ supports ALTER TABLE DROP COLUMN.
  // For older versions this migration is irreversible.
  db.exec(`
    ALTER TABLE unified_api_keys DROP COLUMN encrypted_key;
    ALTER TABLE unified_api_keys DROP COLUMN iv;
    ALTER TABLE unified_api_keys DROP COLUMN auth_tag;
    ALTER TABLE fusion_api_keys DROP COLUMN encrypted_key;
    ALTER TABLE fusion_api_keys DROP COLUMN iv;
    ALTER TABLE fusion_api_keys DROP COLUMN auth_tag;
  `);
}
