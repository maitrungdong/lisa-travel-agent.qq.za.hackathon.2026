# Verify VPS mới nhận từ BTC

Mục tiêu: trong ~10 phút biết chắc **VPS này là gì, cho mình những gì, có chạy nổi stack Zino không** — trước khi chạy `vps-bootstrap.sh`. Làm xong mới sang [`04-vps-va-ci-cd.md`](./04-vps-va-ci-cd.md).

## 0. Hỏi BTC 6 thông tin (nếu chưa có)

| Cần | Vì sao |
|---|---|
| IP public + port SSH | Nhiều nơi đổi SSH sang 2222 |
| User + password / private key | Nếu chỉ có user thường → cần xác nhận có `sudo` |
| Có quyền `sudo`/root không | `vps-bootstrap.sh` cài Docker + mở firewall → bắt buộc |
| Có firewall/security-group ở panel không, ai mở được | Lớp firewall ngoài OS, `ufw` không thấy |
| Được cấp domain/subdomain không, ai sửa DNS | Caddy cần domain thật để xin cert HTTPS |
| VPS dùng chung với team khác không | Tránh 2 người cùng chiếm port 80 |

## 1. Kết nối lần đầu (từ máy dev)

```bash
# Vân tay host + latency trước khi login
nc -vz <IP> 22                      # hoặc port BTC cấp
ssh-keyscan -p 22 <IP>              # xem host key
ping -c 5 <IP>                      # RTT tới VN? nếu >200ms là VPS ở xa

ssh -p 22 user@<IP>                 # login. Có key: ssh -i key.pem user@<IP>
```

Vào được rồi thì **đẩy key của mình lên ngay** để khỏi dùng password:

```bash
ssh-copy-id -p 22 user@<IP>
```

## 2. Chạy script recon (chỉ đọc, không sửa gì)

```bash
cd projects/zino-travel-agent
scp scripts/vps-inspect.sh user@<IP>:/tmp/
ssh user@<IP> 'bash /tmp/vps-inspect.sh' | tee vps-report.txt
```

Hoặc một dòng, không để lại file trên VPS:

```bash
ssh user@<IP> 'bash -s' < scripts/vps-inspect.sh | tee vps-report.txt
```

Script in 11 mục: quyền sudo · OS & loại ảo hóa · CPU/RAM/swap/disk · IP public vs NAT · port đang bị chiếm · firewall · software có sẵn · **egress tới GHCR / Docker Hub / Claude API / Zalo / Let's Encrypt** · NTP · cấu hình SSH · ước lượng RAM stack. Cuối cùng là verdict `FAIL/WARN`.

## 3. Đọc kết quả — ngưỡng cần đạt

| Mục | Tối thiểu | Nếu không đạt |
|---|---|---|
| RAM | 2 GB | 1 GB vẫn chạy nếu tạo swap 2GB (xem §5) và chấp nhận chậm |
| Disk trống | 15 GB | Dọn hoặc xin thêm; 4 image + pgdata ~10-12 GB |
| vCPU | 1 (2 thì thoải mái) | OK — image build ở CI, VPS chỉ `pull` |
| Ảo hóa | KVM | `openvz`/`lxc` → Docker hay lỗi, xin đổi bản KVM |
| Port 80, 443 | trống | Có `apache2`/`nginx` cài sẵn → `sudo systemctl disable --now apache2` |
| Egress 443 | tất cả OK | Có FAIL → hỏi BTC mở outbound; không pull được image là tắc hoàn toàn |
| NTP | `synchronized: yes` | `sudo timedatectl set-ntp true` — lệch giờ làm Let's Encrypt fail |
| cgroup | v2 | v1 vẫn chạy Docker được, chỉ là cũ |

Điểm dễ bị bỏ qua: nếu **IP public ≠ IP trên NIC**, VPS nằm sau NAT → phải port-forward 80/443 ở panel BTC, không thì Caddy không xin được cert.

## 4. Hai thứ script không tự kiểm tra được

**a) Inbound 80/443 từ internet có tới VPS không** — mở listener tạm trên VPS rồi gọi từ máy dev:

```bash
# Trên VPS (cửa sổ 1)
sudo python3 -m http.server 80

# Trên máy dev (cửa sổ 2)
curl -v --max-time 8 http://<IP>/     # thấy "Directory listing" = inbound 80 OK
```

Lặp lại với 443. Không thấy gì → firewall panel hoặc `ufw` đang chặn. Nhớ `Ctrl-C` tắt listener.

**b) DNS đã trỏ đúng chưa** (cần trước khi `docker compose up`, vì Caddy xin cert lúc start):

```bash
dig +short api.<domain> A            # phải trả về đúng IP public của VPS
dig +short api.<domain> @8.8.8.8     # kiểm tra cả resolver ngoài (TTL chưa lan)
```

## 5. Vá nhanh các WARN thường gặp

```bash
# Thiếu swap (RAM ≤ 2GB) — làm trước khi pull image
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Web server cài sẵn chiếm port 80/443
sudo systemctl disable --now apache2 nginx 2>/dev/null

# NTP lệch giờ
sudo timedatectl set-ntp true && timedatectl

# Timezone cho log dễ đọc
sudo timedatectl set-timezone Asia/Ho_Chi_Minh
```

## 6. Có nginx/apache cài sẵn chiếm 80/443 — chọn 1 trong 2

Trước khi tắt, phải biết nó đang phục vụ gì (mục 5 của `vps-inspect.sh` in ra sẵn, hoặc chạy tay):

```bash
sudo nginx -T | grep -E 'server_name|listen|proxy_pass|root|ssl_certificate'
curl -sI http://127.0.0.1/ ; curl -skI https://127.0.0.1/
ls -d /etc/letsencrypt/live/*/ 2>/dev/null      # BTC đã xin cert cho domain nào chưa?
```

**Cách A — Caddy chiếm 80/443 (theo đúng thiết kế repo).** Chọn khi nginx chỉ là trang mặc định "Welcome to nginx".

```bash
sudo systemctl disable --now nginx
ZINO_TAKE_PORTS=1 bash vps-bootstrap.sh
```

**Cách B — giữ nginx làm reverse proxy ngoài cùng.** Chọn khi BTC đã cấu hình sẵn domain + cert trên nginx cho team bạn. Khi đó bỏ service `caddy` khỏi compose, cho `api` bind loopback, rồi trỏ nginx vào:

```yaml
# infra/docker-compose.yml — thay 'expose: 3000' của service api bằng:
    ports:
      - "127.0.0.1:3000:3000"
```

```nginx
# /etc/nginx/conf.d/zino.conf
location /api/ { proxy_pass http://127.0.0.1:3000/; proxy_set_header Host $host; }
```

Cách A ít việc hơn và tự gia hạn cert — mặc định nên chọn A trừ khi BTC yêu cầu giữ nginx.

## 7. HTTPS: 3 đường, chọn theo thứ tự

Mini App bắt buộc gọi API qua HTTPS, mà Let's Encrypt không cấp cert cho IP trần.

**(a) BTC đã cấp cert sẵn** — kiểm tra `sudo ls /etc/nginx/certs/` và `nginx -T | grep ssl_certificate`. Có thì dùng luôn, khỏi phụ thuộc ACME:

```bash
sudo mkdir -p /opt/zino/certs
sudo cp /etc/nginx/certs/<ten>.pem /opt/zino/certs/cert.pem
sudo cp /etc/nginx/certs/<ten>.key /opt/zino/certs/key.pem   # PHẢI có private key
sudo chmod 644 /opt/zino/certs/*
```

```dotenv
# /opt/zino/.env
API_HOST=zah-35.123c.vn          # phải khớp phạm vi cert
CADDY_TLS=tls /certs/cert.pem /certs/key.pem
```

Lưu ý wildcard chỉ phủ **1 cấp**: `*.123c.vn` hợp lệ cho `zah-35.123c.vn`, **không** cho `api.zah-35.123c.vn`. Vì vậy `API_HOST` mới tồn tại — mặc định `api.<DOMAIN>` sẽ làm cert invalid.

**(b) BTC cấp subdomain nhưng không cấp cert** → để `CADDY_TLS` trống, Caddy tự xin Let's Encrypt. Cần inbound port 80 mở (§4) và DNS đã trỏ đúng.

**(c) Không có domain nào** → wildcard-DNS miễn phí, trỏ sẵn về IP của bạn:

```bash
API_HOST=api.118-102-2-135.sslip.io      # hoặc 118.102.2.135.nip.io
dig +short api.118-102-2-135.sslip.io    # phải ra 118.102.2.135
```

Đổi sang domain thật sau chỉ là sửa `API_HOST` + `VITE_API_BASE_URL` rồi deploy lại.

## 8. Xong verify → bootstrap

```bash
scp scripts/vps-bootstrap.sh user@<IP>:/tmp/
ssh user@<IP> 'bash /tmp/vps-bootstrap.sh'
```

Sau đó chạy lại `vps-inspect.sh` một lần nữa: mục 7 phải thấy `docker` + `docker compose v2`, mục 6 thấy `ufw` chỉ mở 22/80/443. Rồi tiếp [`04-vps-va-ci-cd.md`](./04-vps-va-ci-cd.md) §1 bước 2.

Chốt lại 3 câu để báo team: VPS `<OS> / <vCPU> vCPU / <RAM> / <disk>`, IP public `<IP>` (NAT: có/không), egress + inbound 80/443: OK/chặn.
