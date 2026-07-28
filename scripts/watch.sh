#!/usr/bin/env bash
# =============================================================================
#  watch.sh — theo dõi Lisa đang làm gì, theo thời gian thực.
#
#  CHẠY TRÊN VPS:
#      bash ~/lisa/scripts/watch.sh            # dòng thời gian của agent
#      bash ~/lisa/scripts/watch.sh --all      # toàn bộ log, không lọc
#      bash ~/lisa/scripts/watch.sh --db       # trạng thái DB, làm mới mỗi 3s
#
#  Cách đọc dòng thời gian:
#      [a1b2c3] ▶ Đông: nhóm mình đi Vũng Tàu…   ← tin vào (6 số cuối chat id)
#      [a1b2c3]   🔧 create_trip(name="…") ✓ 42ms  ← agent gọi tool
#      [a1b2c3] ◀ trả lời 320 ký tự · 2 vòng · 3.1s ← tin ra
# =============================================================================
set -uo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/lisa}"
cd "$COMPOSE_DIR" || { echo "Không vào được $COMPOSE_DIR"; exit 1; }

case "${1:-}" in
  --all)
    exec docker compose logs -f api
    ;;

  --db)
    # Ảnh chụp trạng thái, làm mới liên tục — hữu ích khi diễn thử
    while true; do
      clear
      printf '\033[1;36m═══ LISA · %s ═══\033[0m\n\n' "$(date '+%H:%M:%S')"
      docker compose exec -T postgres psql -U lisa -d lisa -q <<'SQL'
\pset border 2
SELECT c.zalo_chat_id AS chat, c.chat_type AS loai, c.seen_count AS lan_gap,
       t.name AS chuyen_di, t.status AS trang_thai
FROM conversations c LEFT JOIN trips t ON t.id = c.active_trip_id
ORDER BY c.last_seen_at DESC LIMIT 5;

SELECT kind AS job, status, count(*) FROM jobs GROUP BY kind, status ORDER BY 1,2;

SELECT (SELECT count(*) FROM expenses) AS chi_phi,
       (SELECT count(*) FROM events)   AS lich_trinh,
       (SELECT count(*) FROM photos)   AS anh,
       (SELECT count(*) FROM notes)    AS ghi_chu,
       (SELECT count(*) FROM reminders WHERE NOT sent) AS nhac_cho,
       (SELECT count(*) FROM partner_oas WHERE connected) AS oa_ket_noi;

SELECT left(content, 100) AS bo_nho_dai_han FROM group_memory
WHERE content <> '' ORDER BY updated_at DESC LIMIT 2;
SQL
      printf '\n\033[0;90mCtrl+C để thoát · làm mới sau 3s\033[0m\n'
      sleep 3
    done
    ;;

  -h|--help)
    sed -n '2,16p' "$0"
    exit 0
    ;;

  *)
    # Mặc định: chỉ giữ dòng có ý nghĩa với người xem
    printf '\033[1;36m═══ Theo dõi Lisa · Ctrl+C để thoát ═══\033[0m\n\n'
    docker compose logs -f --tail 40 api 2>&1 | grep --line-buffered -E \
      '▶|◀|🔧|⏰|📩|ERROR|WARN|Schema đã đồng bộ|Worker đã chạy|listening|job#'
    ;;
esac
