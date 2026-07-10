-- Up Migration
-- USERS: authentication principal. PII (email, phone) is encrypted at rest in
-- the app layer; *_bidx columns hold keyed blind-index hashes so we can still
-- do equality lookups (login by email) without storing plaintext.
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_enc       text        NOT NULL,             -- AES-256-GCM envelope
  email_bidx      char(64)    NOT NULL,             -- HMAC blind index (lowercased)
  phone_enc       text,
  phone_bidx      char(64),
  password_hash   text        NOT NULL,             -- argon2id
  role            user_role   NOT NULL DEFAULT 'patient',
  status          user_status NOT NULL DEFAULT 'active',
  email_verified  boolean     NOT NULL DEFAULT false,
  mfa_enabled     boolean     NOT NULL DEFAULT false,
  mfa_secret_enc  text,                             -- encrypted TOTP secret
  failed_logins   int         NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_bidx_uq ON users (email_bidx);
CREATE INDEX users_phone_bidx_idx ON users (phone_bidx) WHERE phone_bidx IS NOT NULL;
CREATE INDEX users_role_idx ON users (role) WHERE status = 'active';
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- PROFILES: 1:1 with users, non-auth demographic data (also PII-encrypted).
CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name_enc text,
  dob_enc       text,
  gender        text,
  address_enc   text,
  locale        text NOT NULL DEFAULT 'en-IN',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- SESSIONS + refresh-token rotation. We store only a HASH of the refresh token
-- and a "family" id. Presenting a rotated/old token from a family flags reuse
-- (token theft) and we revoke the whole family.
CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,
  refresh_token_hash char(64) NOT NULL,             -- sha256 of the refresh token
  user_agent         text,
  ip                 inet,
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  replaced_by        uuid REFERENCES sessions(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE UNIQUE INDEX sessions_rt_hash_uq ON sessions (refresh_token_hash);
CREATE INDEX sessions_family_idx ON sessions (family_id);

-- Down Migration
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS users;
