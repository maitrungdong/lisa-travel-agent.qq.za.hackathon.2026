#!/usr/bin/env bash
# =============================================================================
#  connect-partner-oa.sh — nạp thủ công một OA vào mạng lưới Partner Network.
#
#  CHẠY TRÊN VPS, trong /opt/zino:
#      bash ~/zino/scripts/connect-partner-oa.sh '<ACCESS_TOKEN>'
#
#  VÌ SAO CẦN SCRIPT NÀY:
#  Luồng chuẩn là OAuth v4 (/oa/connect). Nhưng Zalo từ chối OAuth khi ứng dụng
#  chưa được duyệt (error_code -14029), mà duyệt mất vài ngày.
#  Đường vòng hợp lệ: lấy Access Token trực tiếp từ
#      developers.zalo.me → app → Công cụ → API Explorer → Lấy Access Token
#  rồi nạp vào DB bằng script này. Token sống 25 giờ — đủ cho một buổi demo.
#
#  ⚠ Token lấy tay KHÔNG kèm refresh_token → hết 25h phải lấy lại.
#    Khi pitch nên nói thẳng điều này; luồng OAuth tự động đã implement sẵn.
# =============================================================================
set -euo pipefail

TOKEN="${1:-}"
[ -n "$TOKEN" ] || { echo "Dùng: bash $0 '<ACCESS_TOKEN>'"; exit 1; }

COMPOSE_DIR="${COMPOSE_DIR:-/opt/zino}"
CITY="${OA_CITY:-Vũng Tàu}"
CATEGORY="${OA_CATEGORY:-HOTEL}"

C_GRN=$'\033[0;32m'; C_RED=$'\033[0;31m'; C_CYN=$'\033[1;36m'; C_OFF=$'\033[0m'
step() { printf '\n%s==> %s%s\n' "$C_CYN" "$*" "$C_OFF"; }
die()  { printf '\n%s[LỖI]%s %s\n\n' "$C_RED" "$C_OFF" "$*"; exit 1; }

# ---------------------------------------------------------------------------
step "1/3 · Hỏi Zalo xem token này thuộc OA nào"

# getoa vừa lấy được hồ sơ OA, vừa là phép thử token có dùng được không.
RESP="$(curl -s --max-time 15 "https://openapi.zalo.me/v2.0/oa/getoa" -H "access_token: $TOKEN")"
echo "$RESP" | head -c 400; echo

ERR="$(printf '%s' "$RESP" | grep -o '"error":[-0-9]*' | head -1 | cut -d: -f2 || true)"
[ "$ERR" = "0" ] || die "Zalo từ chối token (error=$ERR). Lấy token mới ở API Explorer.
Nếu error = -14029 thì ứng dụng chưa được duyệt — API Explorer cũng không cứu được."

pick() { printf '%s' "$RESP" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
OA_ID="$(pick oaid)"
OA_NAME="$(pick name)"
OA_AVATAR="$(pick avatar)"
OA_CATE="$(pick cate_name)"

[ -n "$OA_ID" ] || die "Không đọc được oaid từ phản hồi."
printf '  OA   : %s (%s)\n  Ngành: %s\n' "$OA_NAME" "$OA_ID" "${OA_CATE:-?}"

# ---------------------------------------------------------------------------
step "2/3 · Nạp vào bảng partner_oas"

cd "$COMPOSE_DIR" || die "Không vào được $COMPOSE_DIR"

# Truyền qua biến môi trường của psql thay vì nội suy vào chuỗi SQL —
# token và tên OA có thể chứa dấu nháy, nội suy thẳng là hỏng câu lệnh.
docker compose exec -T \
  -e V_OA_ID="$OA_ID" -e V_NAME="$OA_NAME" -e V_AVATAR="$OA_AVATAR" \
  -e V_TOKEN="$TOKEN" -e V_CITY="$CITY" -e V_CAT="$CATEGORY" \
  postgres psql -U zino -d zino -v ON_ERROR_STOP=1 <<'SQL' || die "Ghi DB thất bại"
INSERT INTO partner_oas (
  oa_id, name, category, city, description, avatar_url, deeplink,
  connected, access_token, token_expires_at, connected_at, auto_reply, inventory_note
) VALUES (
  :'V_OA_ID', :'V_NAME', :'V_CAT', :'V_CITY',
  'Đối tác trong mạng lưới Zino', NULLIF(:'V_AVATAR',''),
  'https://zalo.me/' || :'V_OA_ID',
  true, :'V_TOKEN', now() + interval '24 hours', now(), true,
  $inv$Phòng và giá (đã gồm ăn sáng, chưa VAT):
- Deluxe hướng vườn 1.500.000đ/đêm (2 khách)
- Deluxe hướng biển 1.900.000đ/đêm (2 khách)
- Family Suite      2.800.000đ/đêm (4 khách)
Tình trạng 12-14/08: còn 3 Deluxe hướng biển, 1 Family Suite.
Huỷ miễn phí trước 7 ngày, sau đó thu 50%.
Nhận phòng 14h, trả phòng 12h. Có hồ bơi, spa, bãi đỗ xe miễn phí.
Nhóm từ 6 khách giảm 10%.$inv$
)
ON CONFLICT (oa_id) DO UPDATE SET
  name = EXCLUDED.name,
  connected = true,
  access_token = EXCLUDED.access_token,
  token_expires_at = EXCLUDED.token_expires_at,
  connected_at = now(),
  avatar_url = COALESCE(EXCLUDED.avatar_url, partner_oas.avatar_url),
  inventory_note = COALESCE(partner_oas.inventory_note, EXCLUDED.inventory_note);

SELECT oa_id, name, city, connected, token_expires_at FROM partner_oas WHERE connected = true;
SQL

# ---------------------------------------------------------------------------
step "3/3 · Kiểm tra qua API"

BASE="$(grep '^PUBLIC_BASE_URL=' .env | tail -1 | cut -d= -f2- | tr -d '[:space:]' | sed 's:/*$::')"
curl -s "${BASE}/oa/network"; echo

printf '\n%s✅ Xong%s\n' "$C_GRN" "$C_OFF"
cat <<EOF

  Bước tiếp theo — kiểm chứng vòng lặp:

  1. Từ Zalo CÁ NHÂN (không phải tài khoản quản trị OA), nhắn cho OA "$OA_NAME":
       "Chào shop, nhóm mình 6 người muốn đặt phòng 12-14/08.
        Cho mình hỏi giá và chính sách huỷ nhé!"

  2. Xem log:
       cd $COMPOSE_DIR && docker compose logs -f api | grep -iE "oa|lead|merchant"

  3. Xem lead đã vào chưa:
       docker compose exec postgres psql -U zino -d zino -c \\
         "SELECT id,status,left(last_user_message,40),left(last_reply,60) FROM oa_leads ORDER BY id DESC LIMIT 3;"

  Nếu log im lặng hoàn toàn → webhook không bắn (app chưa duyệt).
  Chiều GỬI vẫn dùng được; chỉ mất phần tự động nhận.

EOF
