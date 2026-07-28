#!/usr/bin/env bash
#
#  check-v7.sh — chẩn đoán "v7 đã chạy chưa", kiểm từng tầng một.
#
#  CHẠY TRÊN VPS:  bash ~/zino/scripts/check-v7.sh
#
#  Nó không sửa gì, chỉ đọc. Mỗi tầng in ✔ hoặc ✘ kèm cách khắc phục, nên
#  đọc từ trên xuống và dừng ở dấu ✘ ĐẦU TIÊN — các tầng dưới phụ thuộc tầng
#  trên nên sẽ đỏ theo dây chuyền.
#
set -uo pipefail

DIR="${COMPOSE_DIR:-/opt/zino}"
cd "$DIR" 2>/dev/null || { echo "✘ Không vào được $DIR"; exit 1; }

PG_USER="${PG_USER:-lisa}"   # compose trên VPS vẫn là project 'lisa' từ thời v2
PG_DB="${PG_DB:-lisa}"

ok(){ printf '  \033[32m✔\033[0m %s\n' "$*"; }
no(){ printf '  \033[31m✘\033[0m %s\n' "$*"; }
hm(){ printf '  \033[33m?\033[0m %s\n' "$*"; }
h(){ printf '\n\033[1;36m%s\033[0m\n' "$*"; }
fix(){ printf '     → %s\n' "$*"; }

psql(){ docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null; }

FAIL=0

# ───────────────────────────────────────────────────────────────────
h "1. Container"
API=$(docker compose ps -q api 2>/dev/null)
if [ -z "$API" ]; then
  no "container api không chạy"; fix "docker compose up -d api"; exit 1
fi
IMG=$(docker inspect "$API" --format '{{.Config.Image}}')
BUILT=$(docker image inspect "$IMG" --format '{{.Created}}' 2>/dev/null | cut -c1-19)
STARTED=$(docker inspect "$API" --format '{{.State.StartedAt}}' | cut -c1-19)
ok "api đang chạy · image $IMG"
echo "     image build lúc : $BUILT"
echo "     container start : $STARTED"
hm "Nếu build TRƯỚC lúc bạn sửa code thì đang chạy bản CŨ — đó là lý do hay gặp nhất"
fix "cd ~/zino && git pull && docker build -t zino-api:local apps/api && cd $DIR && docker compose up -d api"

# ───────────────────────────────────────────────────────────────────
h "2. Code v7 có TRONG image không"
if docker compose exec -T api sh -c 'ls dist/pipeline/v7.service.js' >/dev/null 2>&1; then
  ok "dist/pipeline/v7.service.js tồn tại"
else
  no "KHÔNG có v7.service.js trong image → image được build từ code cũ"
  fix "build lại image (lệnh ở trên)"; FAIL=1
fi

# ───────────────────────────────────────────────────────────────────
h "3. Biến môi trường TRONG container"
env_of(){ docker compose exec -T api sh -c "printenv $1" 2>/dev/null | tr -d '\r'; }
for v in ZINO_V7_ENABLED ZINO_AGENT_ENV_ID ZINO_AGENT_INTAKE_ID ZINO_AGENT_BRAIN_ID ZINO_AGENT_FINALIZER_ID; do
  val=$(env_of "$v")
  if [ -n "$val" ]; then ok "$v = $val"; else no "$v CHƯA ĐẶT"; FAIL=1; fi
done
key=$(env_of ZINO_AGENT_API_KEY); akey=$(env_of ANTHROPIC_API_KEY)
if [ -n "$key" ]; then ok "ZINO_AGENT_API_KEY có (${#key} ký tự)"
elif [ -n "$akey" ]; then hm "ZINO_AGENT_API_KEY trống → rơi về ANTHROPIC_API_KEY"
     fix "3 agent v7 ở workspace KHÁC thì phải đặt key riêng, không sẽ 404"
else no "không có key nào"; FAIL=1; fi

if [ "$(env_of ZINO_V7_ENABLED)" != "1" ]; then
  no "CỜ ĐANG TẮT — mọi đường v7 bị short-circuit"
  fix "sửa $DIR/.env rồi: docker compose up -d api"
  FAIL=1
fi

# ───────────────────────────────────────────────────────────────────
h "4. Database"
if [ "$(psql "select 1 from information_schema.tables where table_name='pipeline_runs'")" = "1" ]; then
  ok "bảng pipeline_runs tồn tại"
  for c in thin_state reply_contract; do
    if [ "$(psql "select 1 from information_schema.columns where table_name='pipeline_runs' and column_name='$c'")" = "1" ]; then
      ok "cột $c"
    else no "thiếu cột $c → bootstrap.sql chưa chạy bản mới"; FAIL=1; fi
  done
else
  no "chưa có bảng pipeline_runs"
  fix "app tạo lúc khởi động; xem log có dòng 'Schema đã đồng bộ' không"
  FAIL=1
fi

# ───────────────────────────────────────────────────────────────────
h "5. Đã có lượt v7 nào chưa"
RUNS=$(psql "select count(*) from pipeline_runs")
JOBS=$(psql "select count(*) from jobs where kind='v7_turn'")
echo "     pipeline_runs : ${RUNS:-?}"
echo "     job v7_turn   : ${JOBS:-?}"

if [ "${JOBS:-0}" = "0" ]; then
  no "CHƯA CÓ job v7_turn nào → flow chưa bao giờ được mở"
  fix "nghĩa là AgentService chưa gọi tool start_planning_flow."
  fix "Nhắn thẳng cho bot: 'lên plan Đà Lạt 4 người cuối tuần này, thiên về chill'"
  fix "Vẫn không có job → tool chưa được nạp (xem lại tầng 2 và 3)"
else
  ok "đã có $JOBS job v7_turn"
  echo
  echo "  Trạng thái job:"
  psql "select '     '||status||' : '||count(*) from jobs where kind='v7_turn' group by status"
  ERR=$(psql "select last_error from jobs where kind='v7_turn' and last_error is not null order by id desc limit 1")
  [ -n "$ERR" ] && { no "Lỗi gần nhất:"; echo "     $ERR"; FAIL=1; }
  echo
  echo "  Run gần nhất:"
  psql "select '     #'||id||'  '||status||'  stage='||coalesce(stage,'-')||'  '||to_char(updated_at,'HH24:MI:SS') from pipeline_runs order by id desc limit 5"
fi

# ───────────────────────────────────────────────────────────────────
h "6. Log v7 (100 dòng gần nhất)"
LOG=$(docker compose logs --tail=300 api 2>/dev/null | grep -E "V7Service|ManagedAgentDriver|v7_turn" | tail -20)
if [ -n "$LOG" ]; then ok "có log v7:"; echo "$LOG" | sed 's/^/     /'
else no "KHÔNG có dòng log v7 nào → chưa lượt nào chạy tới V7Service"; fi

# ───────────────────────────────────────────────────────────────────
h "7. Kết luận"
if [ "$FAIL" = "0" ] && [ "${JOBS:-0}" != "0" ]; then
  ok "Mọi tầng đều thông. Nếu bot vẫn không trả lời đúng thì vấn đề nằm ở PROMPT"
  fix "chạy scripts/spike-v7.mjs từ máy dev để soi output từng agent"
else
  no "Có tầng chưa thông — sửa dấu ✘ ĐẦU TIÊN ở trên rồi chạy lại script này"
fi
echo
