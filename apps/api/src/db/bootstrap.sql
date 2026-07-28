-- =============================================================================
--  Schema Zino — IDEMPOTENT. Chạy được nhiều lần, chạy trên DB rỗng lẫn DB đã
--  có migration 0000 cũ (trips/members/events/expenses/activities).
--
--  Vì sao không dùng drizzle-kit lúc deploy: nó cần esbuild native binary khớp
--  platform. Trên đường deploy hackathon, một file SQL chạy thẳng thì ít thứ
--  hỏng hơn. drizzle-kit vẫn dùng được lúc dev để sinh diff.
-- =============================================================================

-- ── Hội thoại & trí nhớ ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id              serial PRIMARY KEY,
  zalo_chat_id    varchar(64)  NOT NULL,
  chat_type       varchar(16)  NOT NULL DEFAULT 'direct',
  title           text,
  active_trip_id  bigint,
  seen_count      integer      NOT NULL DEFAULT 0,
  first_seen_at   timestamptz  NOT NULL DEFAULT now(),
  last_seen_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_chat_uq ON conversations (zalo_chat_id);

CREATE TABLE IF NOT EXISTS messages (
  id               serial PRIMARY KEY,
  conversation_id  bigint       NOT NULL REFERENCES conversations(id),
  zalo_message_id  varchar(128),
  role             varchar(16)  NOT NULL,
  sender_zalo_id   varchar(64),
  sender_name      text,
  text             text,
  image_url        text,
  raw_event        jsonb,
  created_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS messages_conv_idx   ON messages (conversation_id, created_at);
-- Chốt chặn idempotency: Zalo retry webhook khi timeout
CREATE UNIQUE INDEX IF NOT EXISTS messages_zalo_id_uq ON messages (zalo_message_id);

CREATE TABLE IF NOT EXISTS group_memory (
  id               serial PRIMARY KEY,
  conversation_id  bigint      NOT NULL REFERENCES conversations(id),
  content          text        NOT NULL DEFAULT '',
  version          integer     NOT NULL DEFAULT 1,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS group_memory_conv_uq ON group_memory (conversation_id);

-- ── Chuyến đi ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trips (
  id            serial PRIMARY KEY,
  zalo_group_id varchar(64),
  name          text        NOT NULL,
  destination   text        NOT NULL,
  start_date    timestamptz NOT NULL,
  end_date      timestamptz NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'planning',
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS conversation_id     bigint;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS budget_per_person   bigint;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS notes               text;
CREATE INDEX IF NOT EXISTS trips_conv_idx ON trips (conversation_id);

CREATE TABLE IF NOT EXISTS members (
  id           serial PRIMARY KEY,
  trip_id      bigint      NOT NULL REFERENCES trips(id),
  zalo_user_id varchar(64) NOT NULL,
  display_name text        NOT NULL
);
CREATE INDEX        IF NOT EXISTS members_trip_idx     ON members (trip_id);
CREATE UNIQUE INDEX IF NOT EXISTS members_trip_user_uq ON members (trip_id, zalo_user_id);

CREATE TABLE IF NOT EXISTS events (
  id         serial PRIMARY KEY,
  trip_id    bigint      NOT NULL REFERENCES trips(id),
  title      text        NOT NULL,
  starts_at  timestamptz NOT NULL,
  location   text,
  created_by varchar(64) NOT NULL DEFAULT 'zino',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS ends_at        timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS kind           varchar(24) NOT NULL DEFAULT 'activity';
ALTER TABLE events ADD COLUMN IF NOT EXISTS note           text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS estimated_cost bigint;
CREATE INDEX IF NOT EXISTS events_trip_idx ON events (trip_id, starts_at);

CREATE TABLE IF NOT EXISTS expenses (
  id         serial PRIMARY KEY,
  trip_id    bigint      NOT NULL REFERENCES trips(id),
  title      text        NOT NULL,
  amount     bigint      NOT NULL,
  paid_by    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category           varchar(24) NOT NULL DEFAULT 'other';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS paid_by_name       text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS split_mode         varchar(16) NOT NULL DEFAULT 'equal';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_photo_url  text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS spent_at           timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS expenses_trip_idx ON expenses (trip_id);

CREATE TABLE IF NOT EXISTS expense_splits (
  id              serial PRIMARY KEY,
  expense_id      bigint      NOT NULL REFERENCES expenses(id),
  member_zalo_id  varchar(64) NOT NULL,
  member_name     text,
  share_amount    bigint      NOT NULL
);
CREATE INDEX IF NOT EXISTS expense_splits_expense_idx ON expense_splits (expense_id);

CREATE TABLE IF NOT EXISTS notes (
  id             serial PRIMARY KEY,
  trip_id        bigint      NOT NULL REFERENCES trips(id),
  author_zalo_id varchar(64),
  author_name    text,
  content        text        NOT NULL,
  kind           varchar(16) NOT NULL DEFAULT 'note',
  taken_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_trip_idx ON notes (trip_id, taken_at);

CREATE TABLE IF NOT EXISTS photos (
  id               serial PRIMARY KEY,
  trip_id          bigint      NOT NULL REFERENCES trips(id),
  url              text        NOT NULL,
  caption          text,
  uploader_zalo_id varchar(64),
  uploader_name    text,
  taken_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_trip_idx ON photos (trip_id, taken_at);

CREATE TABLE IF NOT EXISTS activities (
  id         serial PRIMARY KEY,
  trip_id    bigint      NOT NULL REFERENCES trips(id),
  kind       varchar(32) NOT NULL,
  content    text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_trip_idx ON activities (trip_id);

-- ── Vận hành ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id         serial PRIMARY KEY,
  kind       varchar(32) NOT NULL,
  dedupe_key varchar(128),
  payload    jsonb       NOT NULL,
  status     varchar(16) NOT NULL DEFAULT 'pending',
  run_at     timestamptz NOT NULL DEFAULT now(),
  attempts   integer     NOT NULL DEFAULT 0,
  last_error text,
  locked_by  varchar(64),
  locked_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_poll_idx ON jobs (status, run_at);
-- Tra nhanh "cùng dedupe_key có ai đang chạy không" — điều kiện serialize hội thoại
CREATE INDEX IF NOT EXISTS jobs_dedupe_running_idx ON jobs (dedupe_key, status);

CREATE TABLE IF NOT EXISTS reminders (
  id              serial PRIMARY KEY,
  conversation_id bigint      NOT NULL REFERENCES conversations(id),
  trip_id         bigint,
  fire_at         timestamptz NOT NULL,
  message         text        NOT NULL,
  sent            boolean     NOT NULL DEFAULT false,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_due_idx ON reminders (sent, fire_at);

CREATE TABLE IF NOT EXISTS partner_oas (
  id          serial PRIMARY KEY,
  oa_id       varchar(64) NOT NULL,
  name        text        NOT NULL,
  category    varchar(24) NOT NULL,
  city        text        NOT NULL,
  description text,
  price_hint  text,
  lat         text,
  lng         text,
  avatar_url  text,
  deeplink    text,
  tags        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_oas_oa_uq     ON partner_oas (oa_id);
CREATE INDEX        IF NOT EXISTS partner_oas_search_idx ON partner_oas (city, category);

-- ── Partner Network: uỷ quyền OA đối tác ────────────────────────────────────
-- OA bấm "Cho phép" → app nhận webhook tin user gửi OA đó và trả lời thay họ.
-- Xem docs/PARTNER-NETWORK.md.

ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS connected        boolean     NOT NULL DEFAULT false;
ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS access_token     text;
ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS refresh_token    text;
ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS connected_at     timestamptz;
ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS auto_reply       boolean     NOT NULL DEFAULT true;
ALTER TABLE partner_oas ADD COLUMN IF NOT EXISTS inventory_note   text;

-- PKCE: giữ code_verifier giữa /oa/connect và /oa/callback. TTL 10 phút.
CREATE TABLE IF NOT EXISTS oauth_states (
  state         varchar(64) PRIMARY KEY,
  code_verifier varchar(128) NOT NULL,
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Lead: user hỏi OA đối tác, bắt nguồn từ hội thoại Zino.
CREATE TABLE IF NOT EXISTS oa_leads (
  id                serial PRIMARY KEY,
  partner_oa_id     bigint      NOT NULL REFERENCES partner_oas(id),
  oa_user_id        varchar(64) NOT NULL,
  oa_user_name      text,
  conversation_id   bigint,
  trip_id           bigint,
  last_user_message text,
  last_reply        text,
  status            varchar(16) NOT NULL DEFAULT 'new',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX        IF NOT EXISTS oa_leads_partner_idx     ON oa_leads (partner_oa_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS oa_leads_partner_user_uq ON oa_leads (partner_oa_id, oa_user_id);

-- ============================================================================
-- Pipeline lên kế hoạch — 4 agent chạy tuần tự A → B → C → [chờ owner] → D.
-- Một run sống hàng giờ và qua nhiều tin nhắn nên phải nằm ở DB, không phải RAM.
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id                     serial PRIMARY KEY,
  conversation_id        bigint      NOT NULL REFERENCES conversations(id),
  zalo_chat_id           varchar(64) NOT NULL,
  owner_zalo_id          varchar(64) NOT NULL,
  owner_name             text,
  stage                  varchar(1),
  status                 varchar(24) NOT NULL DEFAULT 'running_a',
  trace_id               varchar(36) NOT NULL,
  agent_sessions         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  alignment_result       jsonb,
  sourcing_result        jsonb,
  planning_result        jsonb,
  package_result         jsonb,
  pending_question       jsonb,
  scout_retries          integer     NOT NULL DEFAULT 0,
  selected_candidate_id  varchar(64),
  expires_at             timestamptz NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_runs_conv_idx ON pipeline_runs (conversation_id, status);

-- Một hội thoại chỉ được có TỐI ĐA MỘT run chưa kết thúc.
-- Đây là chốt chặn cho tình huống hai người trong nhóm cùng nhờ lên kế hoạch:
-- người thứ hai sẽ nhận lỗi insert thay vì tạo ra run thứ hai chạy song song.
CREATE UNIQUE INDEX IF NOT EXISTS pipeline_runs_one_active_uq
  ON pipeline_runs (conversation_id)
  WHERE status NOT IN ('done','blocked','failed','expired','cancelled');

-- ============================================================================
-- Danh tính Mini App ↔ thành viên nhóm.
--
-- Vì sao cần bảng nối: Zalo Bot API và Zalo Mini App nhìn CÙNG một con người
-- dưới hai id khác namespace. Bot thấy `from.id` (vd `e8580118d94d3013695c`),
-- Mini App thấy id định danh theo Zalo App (chuỗi số dài). Zalo không có API
-- nào nối hai cái đó, nên phải nối một lần bằng mã ghép đôi.
-- ============================================================================

-- Người dùng nhìn từ phía Mini App. `zalo_app_user_id` là id Zalo trả về khi
-- server verify access token qua graph.zalo.me — KHÔNG phải giá trị client khai.
CREATE TABLE IF NOT EXISTS app_users (
  id                serial PRIMARY KEY,
  zalo_app_user_id  varchar(64) NOT NULL,
  display_name      text,
  avatar_url        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_zalo_uq ON app_users (zalo_app_user_id);

-- Mã ghép đôi 6 số. Hạn ngắn + dùng một lần vì nó được gõ công khai trong
-- nhóm chat: ai cũng đọc được, nên giá trị của nó phải hết hạn nhanh.
CREATE TABLE IF NOT EXISTS link_codes (
  id           serial PRIMARY KEY,
  code         varchar(8)  NOT NULL,
  app_user_id  bigint      NOT NULL REFERENCES app_users(id),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- Chỉ chặn trùng trên các mã CÒN SỐNG — mã đã dùng/hết hạn được phép tái sinh.
CREATE UNIQUE INDEX IF NOT EXISTS link_codes_active_uq
  ON link_codes (code) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS link_codes_user_idx ON link_codes (app_user_id, created_at);

-- Kết quả nối: một người Mini App ↔ một id phía Bot.
-- UNIQUE cả hai chiều: một tài khoản Zalo chỉ là một người trong nhóm, và
-- ngược lại — nếu không, hai người có thể cùng nhận mình là "Đông".
CREATE TABLE IF NOT EXISTS person_links (
  id               serial PRIMARY KEY,
  app_user_id      bigint      NOT NULL REFERENCES app_users(id),
  zalo_bot_user_id varchar(64) NOT NULL,
  display_name     text,
  linked_via       varchar(16) NOT NULL DEFAULT 'code',
  conversation_id  bigint,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS person_links_app_uq ON person_links (app_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS person_links_bot_uq ON person_links (zalo_bot_user_id);

-- v7: thin state + reply contract. ADD COLUMN IF NOT EXISTS nên chạy lại vô hại
-- với DB đã có bảng từ lần deploy trước.
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS thin_state     jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS reply_contract jsonb;

-- ============================================================================
-- J2 — Quyết định nhóm: bàn ở chat, chốt ở app.
--
-- Đây là chỗ duy nhất trong sản phẩm thể hiện Zino dung hoà ý muốn xung đột của
-- nhiều người, nên nó phải lưu được: ai bầu gì, ai chưa bầu, Zino nghiêng cái
-- nào VÀ VÌ SAO, ai là người chốt, có ngược đa số không.
--
-- Bình chọn là bấm nút tường minh trong app. KHÔNG suy diễn từ reaction hay
-- câu chữ trong chat — đó là bài NLU riêng, sai một lần là mất niềm tin.
-- ============================================================================

-- Vai trò trong chuyến. Người gọi @Zino tạo chuyến là người tổ chức.
ALTER TABLE members ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'member';

CREATE TABLE IF NOT EXISTS decisions (
  id                     serial PRIMARY KEY,
  trip_id                bigint      NOT NULL REFERENCES trips(id),
  conversation_id        bigint,
  /** stay | food | transport | activity | other */
  kind                   varchar(24) NOT NULL DEFAULT 'other',
  title                  text        NOT NULL,
  /** open | tie | decided | cancelled */
  status                 varchar(16) NOT NULL DEFAULT 'open',
  /** Zino nghiêng phương án nào, và vì sao — phần "agent có suy nghĩ" */
  recommended_option_id  bigint,
  recommendation_reason  text,
  decided_option_id      bigint,
  decided_by             varchar(64),
  decided_by_name        text,
  decided_at             timestamptz,
  /** Người tổ chức chốt ngược số đông → ghi lại, không giấu */
  against_majority       boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decisions_trip_idx ON decisions (trip_id, status);

-- Mỗi chuyến chỉ được có MỘT quyết định đang mở tại một thời điểm.
-- Nhiều thẻ cam cùng lúc thì nhóm không biết nhìn cái nào trước.
CREATE UNIQUE INDEX IF NOT EXISTS decisions_one_open_uq
  ON decisions (trip_id) WHERE status IN ('open','tie');

CREATE TABLE IF NOT EXISTS decision_options (
  id            serial PRIMARY KEY,
  decision_id   bigint      NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  label         text        NOT NULL,
  detail        text,
  /** VND. NULL = chưa biết giá */
  price         bigint,
  partner_oa_id varchar(64),
  sort_order    integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS decision_options_dec_idx ON decision_options (decision_id, sort_order);

CREATE TABLE IF NOT EXISTS decision_votes (
  id            serial PRIMARY KEY,
  decision_id   bigint      NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  option_id     bigint      NOT NULL REFERENCES decision_options(id) ON DELETE CASCADE,
  zalo_user_id  varchar(64) NOT NULL,
  display_name  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Một người một phiếu cho mỗi quyết định; đổi ý thì UPDATE chứ không thêm dòng.
CREATE UNIQUE INDEX IF NOT EXISTS decision_votes_one_per_person_uq
  ON decision_votes (decision_id, zalo_user_id);

-- ============================================================================
-- J3/J4 — Trạng thái thực thi và quyền sửa dữ liệu.
--
-- Nguyên tắc hiện trên UI: SỬA ĐƯỢC DỮ LIỆU, KHÔNG SỬA ĐƯỢC GIAO DỊCH.
-- Khoản chi do Zino tạo kèm mã giao dịch là bản ghi của một việc đã xảy ra
-- ngoài đời — cho sửa số tiền là biến sổ sách thành chuyện kể lại.
-- ============================================================================

-- Mục lịch trình có 3 trạng thái. Lỗi PHẢI hiện, kèm lý do và đường xử lý —
-- giấu lỗi đi thì người dùng đứng ở bến xe mới biết mình không có vé.
ALTER TABLE events ADD COLUMN IF NOT EXISTS status      varchar(16) NOT NULL DEFAULT 'done';
ALTER TABLE events ADD COLUMN IF NOT EXISTS fail_reason text;
/** zino | user — quyết định ai được sửa */
ALTER TABLE events ADD COLUMN IF NOT EXISTS source      varchar(16) NOT NULL DEFAULT 'user';
/** Mã giữ chỗ / booking bên đối tác (hackathon: mock) */
ALTER TABLE events ADD COLUMN IF NOT EXISTS booking_ref varchar(64);
ALTER TABLE events ADD COLUMN IF NOT EXISTS partner_oa_id varchar(64);

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source   varchar(16) NOT NULL DEFAULT 'user';
/** Có mã giao dịch = tiền đã chuyển thật → khoá số tiền và người trả */
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS txn_code varchar(64);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS note     text;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS created_by varchar(64);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_by varchar(64);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Tick "đã trả" của một cặp chuyển tiền.
--
-- Vì sao phải LƯU: settlement được tính lại mỗi lần mở (từ expenses), nhưng
-- việc "Linh đã chuyển cho Đông" là sự kiện ngoài đời, không suy ra được từ
-- bất kỳ phép tính nào. Không lưu thì tick xong mở lại là mất.
CREATE TABLE IF NOT EXISTS settlement_payments (
  id           serial PRIMARY KEY,
  trip_id      bigint      NOT NULL REFERENCES trips(id),
  from_user_id varchar(64) NOT NULL,
  to_user_id   varchar(64) NOT NULL,
  amount       bigint      NOT NULL,
  ticked_by    varchar(64),
  ticked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_payments_pair_uq
  ON settlement_payments (trip_id, from_user_id, to_user_id);
