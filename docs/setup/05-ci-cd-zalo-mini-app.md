# CI/CD cho Zalo Mini App trên GitHub — thiết kế chuẩn production

> **Cập nhật 23/7/2026:** codebase đã chuyển vào ``. Các path `apps/miniapp`, `package.json`, `pnpm-lock.yaml` trong doc này hiểu là tương đối với thư mục đó; workflows trong `.github/` đã được cập nhật tương ứng.


> **Đối tượng:** team start-up dựng Zalo Mini App + backend trong một monorepo, host trên GitHub, muốn deploy tự động và có kỷ luật môi trường.
>
> **Trạng thái:** các file cấu hình mô tả trong doc này **đã được tạo sẵn trong repo** (`.github/`, `scripts/`). Doc giải thích *vì sao* thiết kế như vậy và *cần làm gì* để chạy được.
>
> **Nguồn kiểm chứng:** đọc trực tiếp source `zmp-cli@4.0.3` từ npm registry + tài liệu chính thức `docs.zaloplatforms.com` (cập nhật 15/6/2026). Chỗ nào chưa chắc chắn đều được đánh dấu ⚠️.

---

## 0. TL;DR — quyết định cốt lõi

| Câu hỏi | Quyết định | Lý do |
|---|---|---|
| Deploy lên Zalo bằng gì? | `zmp-cli` (`zmp deploy --passive --existing`) | Cách duy nhất mở cho mọi developer. Open API deploy chỉ dành cho đối tác giải pháp đã ký hợp tác. |
| Auth trong CI thế nào? | **Ghi thẳng `.env` chứa `APP_ID` + `ZMP_TOKEN`**, không chạy `zmp login` | `zmp login` mặc định cần quét QR. Nhưng credential nó lưu ra chính file `.env` ở project root → CI ghi sẵn file đó là đủ. |
| Pipeline kết thúc ở đâu? | Ở bản **TESTING** trên Zalo | `zmp deploy` **không** publish ra người dùng thật. Publish phải qua xét duyệt của Zalo. |
| Branching | Trunk-based: `main` + feature branch ngắn hạn + tag `v*` | Team nhỏ, không đủ người để gánh git-flow. |
| Môi trường | 3 GitHub Environments: `development` / `testing` / `production` | Mỗi env một Mini App ID + token riêng → sai ở dev không đụng prod. |
| Secret quản ở đâu? | GitHub Environment secrets, `production` bật required reviewers | Không ai deploy prod một mình được. |
| Rủi ro lớn nhất? | **`ZMP_TOKEN` hết hạn** | Có workflow riêng canh hạn và tự mở issue nhắc rotate. |

---

## 1. Hiểu đúng nền tảng trước khi thiết kế pipeline

### 1.1 Zalo Mini App thực chất là gì

Mini App là một **web app tĩnh** (HTML/CSS/JS) chạy trong webview của Zalo. Bạn build ra một thư mục static, upload lên hạ tầng CDN của Zalo (`h5.zdn.vn/zapps/...`), Zalo phục vụ nó cho người dùng.

Hệ quả trực tiếp lên CI/CD:

- **Không có server để deploy.** Không rollout, không blue/green, không canary ở tầng mini app. "Deploy" = upload một bundle mới.
- **Không có runtime env var.** Mọi biến môi trường phải được **inline lúc build**. Đây là điểm mấu chốt của toàn bộ phần cấu hình môi trường bên dưới.
- **Bundle là public.** Bất kỳ ai cũng tải được và đọc được. ⚠️ Mọi thứ bạn nhét vào `VITE_*` đều lộ.
- **Có giới hạn dung lượng.** Zalo định vị Mini App là app gọn nhẹ (tài liệu marketing hay nhắc mốc <10MB). ⚠️ Con số chính xác Zalo có thể đổi — pipeline dùng ngưỡng cấu hình được (`MAX_BUNDLE_MB`, mặc định 8MB) thay vì hardcode.

### 1.2 Bộ công cụ chính thức

| Thành phần | Vai trò trong CI/CD |
|---|---|
| `zmp-cli` (npm, hiện `4.0.3`) | Công cụ duy nhất để upload bản build lên Zalo. Bin: `zmp`. |
| `zmp-sdk` | Bridge tới API native. Không liên quan CI, nhưng **phải pin version** — SDK cập nhật liên tục. |
| `zmp-ui` (ZaUI) | Component library. Tương tự, pin version. |
| `app-config.json` | Cấu hình app (title, header, status bar). Bắt buộc ở project root. CI validate file này. |
| Mini App Open API | Có endpoint `deployMiniApp` / `publishMiniApp` / `requestPublishMiniApp` — **nhưng chỉ mở cho "đối tác giải pháp" đã ký thoả thuận hợp tác với Zalo**. Cá nhân/doanh nghiệp tự phát triển chỉ được webhook + stats. |

### 1.3 `zmp-cli` hoạt động ra sao (đọc từ source)

Đây là phần ít tài liệu nhất và cũng là phần quyết định pipeline chạy được hay không. Các kết luận dưới đây rút ra từ việc đọc source `zmp-cli@4.0.3`:

**Lệnh và flag:**

```
zmp login   --app-id <appId> --token <token>     # non-interactive
zmp build   [-M, --mode <m>]
zmp deploy  [-p, --passive]                      # bỏ mọi prompt
            [-e, --existing]                     # deploy project build sẵn
            [-t, --testing]                      # version status = TESTING
            [-m, --desc <message>]               # mô tả phiên bản (bắt buộc)
            [-o, --outputDir <dir>]              # mặc định `www`
            [-M, --mode <m>]                     # env mode
```

**Credential nằm ở đâu:** `zmp login` không lưu vào keychain hay `~/.config` — nó ghi hai key `APP_ID` và `ZMP_TOKEN` vào **file `.env` ở thư mục gốc project**. `zmp deploy` đọc lại từ đó. 

> Đây là chi tiết quan trọng nhất của toàn bộ thiết kế: CI **không cần** chạy `zmp login`, chỉ cần tự ghi `.env` từ GitHub Secrets. Nhờ vậy tránh được hoàn toàn luồng quét QR.
>
> Hệ quả bảo mật: `.env` phải nằm trong `.gitignore` (đã có), và job deploy phải `rm -f .env` sau khi chạy xong (composite action đã làm).

**Hai loại version status:**

| Status | Hành vi | Dùng cho |
|---|---|---|
| `DEVELOPMENT` (mặc định) | Không hiện trong "Quản lý phiên bản". **Bị ghi đè** mỗi lần deploy. | Môi trường dev — merge xong quét QR xem ngay. |
| `TESTING` (`--testing`) | Được **đánh số và lưu lại**. Gửi xét duyệt được, duyệt xong phát hành được. | Staging và release. |

**`--existing` để làm gì:** mặc định `zmp deploy` sẽ tự build bằng webpack của `zmp-cli`. Nếu bạn dùng Vite (mọi template `zaui-*` đều dùng Vite), bạn muốn tự build rồi chỉ nhờ `zmp` upload — đó là vai trò của `--existing`. Pipeline này dùng `--existing` để giữ quyền kiểm soát hoàn toàn bước build.

**`ZMP_TOKEN` là JWT có hạn.** `zmp-cli` dùng `jsonwebtoken` để decode. Hết hạn → deploy fail với thông báo cụt lủn `Token Invalid!`. ⚠️ Đây là nguyên nhân số một khiến pipeline Zalo Mini App "tự nhiên hỏng".

### 1.4 Ranh giới của tự động hoá

Cần nói thẳng để không thiết kế nhầm:

```
[ commit ] → [ CI ] → [ build ] → [ zmp deploy ] → [ bản DEVELOPMENT/TESTING trên Zalo ]
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │  RANH GIỚI TỰ ĐỘNG HOÁ        │
                                              │  Từ đây trở đi là thao tác    │
                                              │  thủ công trên console Zalo   │
                                              └───────────────────────────────┘
                                                              │
                                        [ gửi xét duyệt ] → [ Zalo review ] → [ publish ]
```

Không có cách nào cho developer thường tự động publish ra người dùng thật. Vì vậy **định nghĩa "deploy production" của team nên là: đưa được một bản TESTING đã qua kiểm thử lên Zalo, sẵn sàng để gửi duyệt.** Đó chính xác là điểm dừng của `release.yml`.

---

## 2. Cấu trúc repository

```
qq.za.hackathon.2026/
├── .github/
│   ├── actions/
│   │   ├── setup-node-pnpm/action.yml   # composite: node + pnpm + cache
│   │   └── zmp-deploy/action.yml        # composite: deploy lên Zalo
│   ├── workflows/
│   │   ├── ci.yml                       # PR + push main: lint/typecheck/test/build
│   │   ├── deploy-miniapp.yml           # reusable: build + upload Zalo
│   │   ├── cd-development.yml           # push main → bản DEVELOPMENT
│   │   ├── release.yml                  # tag v* → bản TESTING + GitHub Release
│   │   ├── deploy-api.yml               # backend → GHCR → hạ tầng
│   │   ├── codeql.yml                   # quét bảo mật
│   │   └── zmp-token-health.yml         # canh hạn ZMP_TOKEN
│   ├── ISSUE_TEMPLATE/bug_report.yml
│   ├── dependabot.yml
│   ├── pull_request_template.md
│   └── CODEOWNERS
├── apps/
│   ├── miniapp/                         # Zalo Mini App (Vite + React + TS)
│   │   ├── app-config.json
│   │   ├── .env.example
│   │   └── www/                         # build output (gitignored)
│   └── api/                             # backend: OA webhook, ZaloPay, BFF
├── packages/                            # code dùng chung (types, sdk client, ui)
├── scripts/
│   ├── zmp-deploy.mjs                   # wrapper non-interactive cho zmp deploy
│   ├── check-zmp-token.mjs              # fail sớm khi token hết hạn
│   └── check-bundle-size.mjs            # gác cổng dung lượng bundle
└── docs/
```

**Vì sao monorepo:** mini app và backend đổi cùng nhau (thêm 1 API là đổi cả hai). Một PR, một lần review, một commit atomic. CI dùng `dorny/paths-filter` để chỉ build phần thay đổi nên không phải trả giá về tốc độ.

**Package manager: pnpm.** Workspace gọn, cài nhanh, `--frozen-lockfile` bắt buộc lockfile khớp — đúng nguyên tắc build tái lập được.

---

## 3. Mô hình môi trường & branching

### 3.1 Branching

```
feature/xyz ──┐
              ├──► main ──► (tự động) bản DEVELOPMENT trên Zalo
fix/abc    ───┘     │
                    └──► tag v1.2.0 ──► (có phê duyệt) bản TESTING + GitHub Release
```

Trunk-based, feature branch sống ngắn (<2 ngày). Không có `develop`. Với team start-up, mỗi nhánh dài hạn thêm vào là thêm một cuộc merge đau đớn mà không đổi lại được gì.

### 3.2 Ba GitHub Environment

Tạo tại **Settings → Environments**.

| Environment | Mini App ID | Trigger | Version status | Bảo vệ |
|---|---|---|---|---|
| `development` | App dev riêng | Tự động khi push `main` | `development` | Không |
| `testing` | App dev riêng (hoặc chung dev) | Chạy tay (`workflow_dispatch`) | `testing` | Không |
| `production` | **App thật** | Tag `v*.*.*` | `testing` | ✅ Required reviewers + chỉ cho phép ref `v*` |

> ⚠️ Lý tưởng là mỗi environment một Mini App ID riêng. Nếu team mới bắt đầu và chỉ có 1 app, dùng chung `ZALO_APP_ID` nhưng **vẫn tách environment** — vì phần khác biệt thật sự nằm ở `VITE_API_BASE_URL` (trỏ backend dev hay prod) và ở lớp phê duyệt.

Một điểm hay của GitHub Environments mà nhiều team bỏ lỡ: khi bật **required reviewers**, job sẽ *dừng và chờ* — người duyệt bấm approve ngay trong tab Actions. Đây là "cổng release" miễn phí, không cần tool ngoài.

### 3.3 Biến môi trường: `vars` vs `secrets`

Đây là chỗ dễ sai nhất trong dự án mini app.

| Loại | Lưu ở đâu | Vào bundle client? | Ví dụ |
|---|---|---|---|
| Công khai, khác nhau theo env | GitHub Environment **Variables** (`vars.*`) | ✅ Có | `API_BASE_URL`, `ZALO_OA_ID`, `SENTRY_DSN`, feature flags |
| Credential deploy | GitHub Environment **Secrets** (`secrets.*`) | ❌ Không — chỉ dùng lúc upload | `ZALO_APP_ID`, `ZMP_TOKEN` |
| Secret nghiệp vụ | **Backend**, không bao giờ ở frontend | ❌ Tuyệt đối không | ZaloPay `key1`/`key2`, OA access token, API key LLM, DB URL |

> 🔴 **Quy tắc không được vi phạm:** mọi biến `VITE_*` bị Vite inline vào file JS. Người dùng mở devtools là đọc được. Nếu bạn nhét ZaloPay `key1` vào `VITE_ZALOPAY_KEY1`, bạn vừa công khai khoá ký giao dịch.
>
> Điều này khớp với ràng buộc đã ghi trong `he-sinh-thai-zalo.md`: **`mac` HMAC của ZaloPay phải được sinh ở server.**

Danh sách secrets/vars cần khai báo:

**Secrets (mỗi environment):**

```
ZALO_APP_ID     # Mini App ID
ZMP_TOKEN       # Access token developer (JWT, có hạn)
```

**Variables (mỗi environment):**

```
API_BASE_URL    # https://api-dev.qq.vn  |  https://api.qq.vn
ZALO_OA_ID
SENTRY_DSN      # tuỳ chọn
ENABLE_MOCK     # true ở dev, false ở prod
MAX_BUNDLE_MB   # tuỳ chọn, mặc định 8
MINIAPP_URL     # link hiển thị ở deployment card của GitHub
```

---

## 4. Các pipeline

### 4.1 `ci.yml` — cổng chất lượng

Chạy trên mọi PR vào `main` và mọi push vào `main`.

```
┌─ changes (paths-filter) ─┐
│                          │
├─ quality  ───────────────┤  lint · typecheck · test + coverage
├─ build-miniapp ──────────┤  build + bundle size + validate app-config.json
├─ build-api ──────────────┤  build + docker build (không push)
│                          │
└─────────► ci-passed ◄────┘  job tổng hợp
```

Vài chi tiết có chủ đích:

- **`concurrency` + `cancel-in-progress`**: push liên tiếp trên cùng PR sẽ huỷ run cũ. Tiết kiệm runner minutes — đáng kể với team nhỏ dùng free tier.
- **`ci-passed` là job tổng hợp**: đặt *job này* làm required status check trong branch protection. Sau này thêm/bớt job con không phải vào sửa lại rule — một chi tiết nhỏ nhưng tiết kiệm rất nhiều bực bội.
- **Build mini app với biến giả** (`VITE_API_BASE_URL: https://api-ci.invalid`): mục tiêu ở đây là bắt lỗi compile, không phải tạo artifact deploy được. Giá trị thật chỉ được inject ở workflow deploy.
- **Bundle size là job bắt buộc, không phải cảnh báo**: bundle phình là lỗi phát hiện muộn nhất và đau nhất (thường vào đúng lúc demo). Chặn ở PR rẻ hơn nhiều.

### 4.2 `deploy-miniapp.yml` — reusable workflow

Toàn bộ logic build-và-upload nằm ở đây. Hai workflow khác gọi lại nó qua `workflow_call`. Một chỗ để sửa, không copy-paste.

```
checkout → setup → build (inject VITE_* từ env) → check token → check bundle
         → cài zmp-cli (pinned) → ghi .env → zmp deploy → xoá .env → job summary
```

Có thể chạy tay qua `workflow_dispatch` (tab Actions → Run workflow) khi cần deploy một nhánh bất kỳ lên môi trường testing.

### 4.3 `cd-development.yml` — vòng lặp hàng ngày

Merge vào `main` → tự deploy bản `DEVELOPMENT`. Vì bản development bị ghi đè mỗi lần, không có rác tích tụ. Team quét QR là thấy `main` mới nhất.

`paths` filter đảm bảo commit chỉ sửa docs không kích hoạt deploy.

### 4.4 `release.yml` — phát hành

```
git tag v1.2.0 && git push origin v1.2.0
      │
      ├─► verify:          lint + typecheck + test (chạy lại, không tin cache của PR)
      ├─► deploy-testing:  environment `production` → CHỜ NGƯỜI DUYỆT → bản TESTING
      └─► github-release:  changelog từ git log + GitHub Release
```

Sau khi workflow xong, bước cuối là **thủ công**: vào developers.zalo.me → Quản lý phiên bản → chọn bản vừa lên → gửi xét duyệt. Job summary in sẵn nhắc nhở này.

### 4.5 `zmp-token-health.yml` — canh chừng token

Chạy 08:00 thứ Hai hàng tuần, kiểm tra `ZMP_TOKEN` của cả 3 environment. Sắp hết hạn → warning. Đã hết hạn → tự mở issue kèm hướng dẫn rotate.

Đây là workflow tôi khuyên **đừng bỏ**. Không có nó, kịch bản điển hình là: hai tuần không release, đến lúc cần deploy gấp thì token đã chết, mất 30 phút loay hoay giữa lúc đang vội.

### 4.6 `deploy-api.yml` — backend

Build image → push GHCR (`ghcr.io/<org>/<repo>/api`) → deploy → smoke test `/health`.

Bước deploy hiện là placeholder vì phụ thuộc hạ tầng bạn chọn. Trong file có sẵn gợi ý cho Fly.io / Cloud Run / Render / VPS.

> 💡 Khi kết nối cloud provider, ưu tiên **OIDC** (`permissions: id-token: write`) thay vì lưu long-lived service account key làm secret. Không có secret nào thì không có secret nào rò rỉ được.

---

## 5. Hệ sinh thái GitHub nên bật

Bạn hỏi nên dùng thêm gì — đây là danh sách theo thứ tự ưu tiên thực tế cho một start-up.

### Bật ngay (chi phí ~15 phút, giá trị cao)

| Tính năng | Vì sao | Trạng thái |
|---|---|---|
| **Branch protection** cho `main` | Không ai push thẳng vào main. Required check = `ci-passed`. Require 1 approval. | Cần bật tay (§6) |
| **Environments + required reviewers** | Cổng release miễn phí, có audit trail. | Cần bật tay (§6) |
| **Secret scanning + push protection** | Chặn commit chứa token **ngay lúc push**, không phải dọn sau. Miễn phí cho repo public. | Cần bật tay |
| **Dependabot** | Đã cấu hình gom nhóm — `zmp-*`/`zaui*` tách riêng vì SDK Zalo hay breaking. | ✅ Đã có file |
| **CODEOWNERS** | Auto request review đúng người; kết hợp branch protection thì không ai tự sửa pipeline một mình. | ✅ Đã có (cần điền username) |
| **Pin action theo SHA** | Action bị compromise là vector supply-chain thật (đã xảy ra trong thực tế). Mọi action trong repo này đã pin SHA; Dependabot sẽ bump giúp. | ✅ Đã làm |

### Bật khi có thời gian

| Tính năng | Vì sao |
|---|---|
| **CodeQL** | Quét lỗ hổng. Miễn phí repo public; repo private cần GitHub Advanced Security → nếu chưa có, tắt workflow và dùng `pnpm audit` trong CI. |
| **GHCR** | Registry đi kèm repo, không cần quản credential riêng. Đã dùng trong `deploy-api.yml`. |
| **GitHub Projects** | Board tracking gắn thẳng với issue/PR. |
| **Merge queue** | Chỉ đáng khi >5 người merge cùng lúc. Team nhỏ chưa cần. |

### Chưa cần

- **Self-hosted runners** — ubuntu-latest thừa sức, thêm runner là thêm việc bảo trì.
- **Deployment protection rules phức tạp / wait timer** — nhiều nghi thức hơn giá trị ở giai đoạn này.

---

## 6. Checklist thiết lập (làm theo thứ tự)

### Bước 1 — Đăng ký Mini App & lấy credential

1. Vào [developers.zalo.me](https://developers.zalo.me) → đăng nhập bằng tài khoản Zalo.
2. Tạo ứng dụng mới, chọn loại **Mini App**. Ghi lại **Mini App ID**.
3. Lấy access token: **Công cụ → API Explorer → chọn đúng ứng dụng ở mục "Chọn ứng dụng" → Lấy Access Token**.
   - ⚠️ Chọn sai ứng dụng là token sẽ không deploy được vào app bạn muốn, mà lỗi báo ra rất mơ hồ.
4. Tạo thêm app riêng cho môi trường dev nếu muốn tách hoàn toàn dev/prod.

> ⚠️ **Cần tự kiểm chứng:** thời hạn chính xác của access token này. `zmp-cli` decode claim `exp` của JWT, nhưng Zalo không công bố rõ TTL. Sau khi lấy token, chạy `node scripts/check-zmp-token.mjs` (với `ZMP_TOKEN` trong env) để biết chính xác còn bao lâu — rồi lên lịch rotate theo con số thật đó.

### Bước 2 — Cấu hình GitHub

```
Settings → Environments → New environment
```

Tạo `development`, `testing`, `production`. Với mỗi cái, thêm secrets `ZALO_APP_ID` + `ZMP_TOKEN` và variables ở §3.3.

Riêng `production`:
- ✅ Required reviewers → chọn ít nhất 1 người
- ✅ Deployment branches → **Selected branches and tags** → thêm rule `v*`

```
Settings → Branches → Add branch protection rule  (branch: main)
```
- ✅ Require a pull request before merging (1 approval)
- ✅ Require status checks to pass → chọn **`CI passed`**
- ✅ Require branches to be up to date
- ✅ Require review from Code Owners
- ✅ Do not allow bypassing the above settings

```
Settings → Code security and analysis
```
- ✅ Secret scanning + Push protection
- ✅ Dependabot alerts + security updates

### Bước 3 — Sửa file cho khớp repo thật

- `.github/CODEOWNERS` → thay `@your-github-username`
- `.github/workflows/deploy-api.yml` → điền lệnh deploy thật
- `apps/miniapp/.env.example` → điền URL thật

### Bước 4 — Chạy thử

```bash
# Local: kiểm tra token còn sống
ZMP_TOKEN=<token> node scripts/check-zmp-token.mjs

# Local: deploy thử bản development
cd apps/miniapp && pnpm build
ZMP_APP_ID=<id> ZMP_TOKEN=<token> ZMP_DESCRIPTION="thử nghiệm" \
  node ../../scripts/zmp-deploy.mjs
```

Nếu local chạy được thì CI cũng sẽ chạy được — cùng một script.

Sau đó: mở một PR nhỏ → xem `ci.yml` chạy → merge → xem `cd-development.yml` deploy → quét QR trên Zalo.

---

## 7. Rủi ro và cách xử lý

| Rủi ro | Mức độ | Cách xử lý |
|---|---|---|
| `ZMP_TOKEN` hết hạn giữa chừng | **Cao** | `zmp-token-health.yml` cảnh báo trước; `check-zmp-token.mjs` fail sớm với thông điệp rõ. |
| Bundle vượt giới hạn Zalo | Cao | `check-bundle-size.mjs` chặn ở CI, in top 10 file lớn nhất vào job summary. |
| Lộ secret qua `VITE_*` | **Cao** | Checklist trong PR template + secret scanning + quy tắc ở §3.3. |
| `zmp-cli` breaking change | Trung bình | Pin `zmp-cli@4.0.3` trong composite action; Dependabot tách nhóm `zmp-*`. |
| `zmp-sdk`/`zmp-ui` breaking | Trung bình | Pin exact version trong `package.json`. Không dùng `^`. |
| Deploy đè lên nhau | Thấp | `concurrency` group theo environment, `cancel-in-progress: false`. |
| Command injection từ commit message | Thấp nhưng nghiêm trọng | Mọi giá trị người dùng kiểm soát đi qua `env:`, không nội suy thẳng vào `run:`. |
| Không rollback được bản `DEVELOPMENT` | Thấp | Bản development vốn dùng-rồi-bỏ. Cần bản ổn định thì dùng `TESTING` (được đánh số, giữ lại). |
| Action bị compromise | Thấp nhưng nghiêm trọng | Pin theo commit SHA thay vì tag. |

---

## 8. Cần tự kiểm chứng trước khi lên production

Những điểm dưới đây tôi **không** xác minh được từ tài liệu công khai — cần mở console/thử thật:

- [ ] **TTL chính xác của `ZMP_TOKEN`** → quyết định tần suất rotate và cron của token-health.
- [ ] **Giới hạn dung lượng bundle hiện hành** → chỉnh `MAX_BUNDLE_MB` cho đúng.
- [ ] **Hành vi thật của `zmp deploy --passive --existing`** khi thiếu prompt → chạy `zmp deploy --help` trên máy bạn để đối chiếu (source CLI bị obfuscate, tôi suy ra flag từ chuỗi trong bundle nên có thể sai lệch nhỏ).
- [ ] **Có thể deploy song song 2 Mini App ID bằng cùng 1 token không** → ảnh hưởng việc dùng chung token giữa các environment.
- [ ] **Timeline xét duyệt của Zalo** → quyết định nhịp release.
- [ ] **Điều kiện trở thành "đối tác giải pháp"** → nếu đạt được, Open API mở ra khả năng tự động hoá cả bước publish, và toàn bộ §1.4 cần thiết kế lại.

---

## 9. Bước tiếp theo

Doc này lo phần *hạ tầng*. Việc còn thiếu để repo chạy được đầu-cuối:

1. **Scaffold `apps/miniapp`** — fork `zaui-shop` hoặc `zmp-blank-templates`, thêm `package.json` với script `lint` / `typecheck` / `test` / `build` (workflow đang gọi các script này).
2. **Scaffold `apps/api`** — Node backend + `Dockerfile` + endpoint `/health`.
3. **Thiết lập pnpm workspace** — `pnpm-workspace.yaml` + `turbo.json` nếu muốn build cache.
4. **Cấu hình Vite** để output ra `www/` (mặc định Vite là `dist/`) — hoặc đổi `output-dir` trong workflow thành `dist`.

---

## 10. Nguồn

**Tài liệu chính thức:**
- [Zalo Mini App CLI — Cài đặt](https://docs.zaloplatforms.com/docs/MA/devtools/cli/intro)
- [Zalo Mini App CLI — Đăng nhập](https://docs.zaloplatforms.com/docs/MA/devtools/cli/login)
- [Zalo Mini App CLI — Xuất bản](https://docs.zaloplatforms.com/docs/MA/devtools/cli/deploy)
- [Cấu hình Zalo Mini App (`app-config.json`)](https://docs.zaloplatforms.com/docs/MA/devtools/app-config)
- [Mini App Open APIs — Tổng quan](https://docs.zaloplatforms.com/docs/MA/openApis/intro)
- [Open API cho đối tác giải pháp — Deploy mini app](https://docs.zaloplatforms.com/docs/MA/openApis/partner/apis/deployMiniApp)
- [Hướng dẫn setup CI/CD cho Mini App (blog Zalo)](https://mini.zalo.me/blog/setup-ci-cd-for-mini-app/)

**Package:**
- [`zmp-cli` trên npm](https://www.npmjs.com/package/zmp-cli) — phân tích flag và cơ chế `.env` dựa trên source `4.0.3`
- [`zaui-shop` — template e-commerce](https://github.com/Zalo-MiniApp/zaui-shop)
- [`zmp-blank-templates`](https://github.com/Zalo-MiniApp/zmp-blank-templates)

**Liên quan trong repo:**
- [`docs/ky-thuat/he-sinh-thai-zalo.md`](./he-sinh-thai-zalo.md) — bản đồ hệ sinh thái Zalo

---
*Doc do AI agent tổng hợp từ source code và tài liệu chính thức. Các mục đánh dấu ⚠️ và toàn bộ §8 cần kiểm chứng lại trước khi đưa vào quyết định kỹ thuật.*
