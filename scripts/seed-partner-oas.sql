-- ============================================================================
-- Nạp danh bạ OA đối tác từ "docs/Mini App & OA List.xlsx" (20 dòng, Nha Trang)
--
-- Chạy trên VPS:
--   docker exec -i lisa-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < ~/zino/scripts/seed-partner-oas.sql
--
-- Idempotent: ON CONFLICT (oa_id) DO UPDATE — chạy lại bao nhiêu lần cũng được.
--
-- Ghi chú dữ liệu:
--   • city='Toàn quốc' cho hãng bay/nhà xe/nền tảng vé — search_partner_oa có
--     nhánh riêng để chúng khớp mọi thành phố.
--   • Vexere xuất hiện 2 lần trong xlsx (Mini App + OA, cùng id) → gộp 1 dòng.
--   • avatar_url là ẢNH MINH HOẠ theo loại hình (Unsplash, không chặn hotlink).
--     Có ảnh thật của đối tác thì UPDATE đè lên — khuôn thẻ không đổi.
--   • price_hint để NULL có chủ đích: giá là việc của web_search lúc chạy,
--     không phải hằng số chôn trong DB.
-- ============================================================================

INSERT INTO partner_oas (oa_id, name, category, city, description, avatar_url, deeplink, tags)
VALUES
  -- ── Chỗ ở · Nha Trang ────────────────────────────────────────────────
  ('3556873486474852700', 'Sheraton Nha Trang Hotel & Spa', 'HOTEL', 'Nha Trang',
   'Khách sạn 5 sao mặt biển Trần Phú, hồ bơi vô cực',
   'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1600&q=85',
   'https://zalo.me/3556873486474852700', 'mặt biển,5 sao,hồ bơi vô cực,OA'),

  ('4330583059155161906', 'InterContinental Nha Trang', 'HOTEL', 'Nha Trang',
   'Resort 5 sao trung tâm bãi biển Nha Trang',
   'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1600&q=85',
   'https://zalo.me/4330583059155161906', '5 sao,mặt biển,gia đình,OA'),

  ('789231673960030970', 'Meliá Vinpearl Nha Trang Empire', 'HOTEL', 'Nha Trang',
   'Căn hộ khách sạn cao cấp trung tâm thành phố',
   'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1600&q=85',
   'https://zalo.me/789231673960030970', 'căn hộ,trung tâm,view biển,OA'),

  ('4080288475866618900', 'Panama Nha Trang', 'HOTEL', 'Nha Trang',
   'Khách sạn tầm trung gần biển, giá tốt',
   'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1600&q=85',
   'https://zalo.me/4080288475866618900', 'tầm trung,gần biển,giá tốt,OA'),

  ('1947958835296336440', 'Mường Thanh Hospitality', 'HOTEL', 'Nha Trang',
   'Chuỗi khách sạn Việt, nhiều chi nhánh Nha Trang',
   'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1600&q=85',
   'https://zalo.me/1947958835296336440', 'chuỗi,tầm trung,OA'),

  ('0948338800', 'Havana Nha Trang Hotel', 'HOTEL', 'Nha Trang',
   'Khách sạn mặt biển đường Trần Phú (zBusiness)',
   'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1600&q=85',
   'https://zalo.me/0948338800', 'mặt biển,zbusiness'),

  -- ── Đi lại · Toàn quốc ───────────────────────────────────────────────
  ('1315653076309382882', 'Vietjet Air', 'TRANSPORT', 'Toàn quốc',
   'Hãng hàng không — vé máy bay giá rẻ',
   'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?w=1600&q=85',
   'https://zalo.me/1315653076309382882', 'máy bay,giá rẻ,OA'),

  ('3149253679280388721', 'Vietnam Airlines', 'TRANSPORT', 'Toàn quốc',
   'Hãng hàng không quốc gia',
   'https://images.unsplash.com/photo-1569154941061-e231b4725ef1?w=1600&q=85',
   'https://zalo.me/3149253679280388721', 'máy bay,full service,OA'),

  ('4105849197048860730', 'Vexere — Vé máy bay, tàu hoả, xe', 'TRANSPORT', 'Toàn quốc',
   'Nền tảng đặt vé xe khách, tàu hoả, máy bay',
   'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=1600&q=85',
   'https://zalo.me/4105849197048860730', 'xe khách,tàu hoả,máy bay,mini app,OA'),

  ('1090257973118325189', 'FUTA Bus Lines', 'TRANSPORT', 'Toàn quốc',
   'Nhà xe Phương Trang — tuyến toàn quốc',
   'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?w=1600&q=85',
   'https://zalo.me/1090257973118325189', 'xe khách,limousine,OA'),

  ('vemaybay', 'Mini App Đặt Vé Máy Bay', 'TRANSPORT', 'Toàn quốc',
   'Mini App đặt vé máy bay ngay trong Zalo',
   'https://images.unsplash.com/photo-1556388158-158ea5ccacbd?w=1600&q=85',
   'https://zalo.me/s/vemaybay', 'máy bay,mini app'),

  -- ── Ăn uống · Nha Trang ──────────────────────────────────────────────
  ('4525256323348108293', 'Nem Nướng Quế Quân', 'FNB', 'Nha Trang',
   'Đặc sản nem nướng Nha Trang (Mini App)',
   'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=1600&q=85',
   'https://zalo.me/s/4525256323348108293', 'nem nướng,đặc sản,mini app'),

  ('121804492084093201', 'Bún Chả Cá Sứa Thảo Hà', 'FNB', 'Nha Trang',
   'Bún chả cá sứa — món sáng đặc trưng Nha Trang (Mini App)',
   'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=1600&q=85',
   'https://zalo.me/s/121804492084093201', 'bún cá,ăn sáng,mini app'),

  ('920029219056349608', 'Nhà hàng Khoái — Hải sản & Đặc sản', 'FNB', 'Nha Trang',
   'Hải sản tươi và đặc sản Nha Trang (Mini App)',
   'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1600&q=85',
   'https://zalo.me/s/920029219056349608', 'hải sản,nhóm đông,mini app'),

  ('1140403146893715685', 'Ga Coffee Nha Trang', 'FNB', 'Nha Trang',
   'Cà phê phong cách nhà ga',
   'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1600&q=85',
   'https://zalo.me/1140403146893715685', 'cà phê,check-in,OA'),

  ('2735455120264370827', 'ZEN Coffee Nha Trang', 'FNB', 'Nha Trang',
   'Cà phê không gian thiền, yên tĩnh',
   'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1600&q=85',
   'https://zalo.me/2735455120264370827', 'cà phê,yên tĩnh,OA'),

  ('1342192031247816245', 'KFC Vinpearl Hòn Tre', 'FNB', 'Nha Trang',
   'KFC chi nhánh Vinpearl Hòn Tre',
   'https://images.unsplash.com/photo-1513639776629-7b61b0ac49cb?w=1600&q=85',
   'https://zalo.me/1342192031247816245', 'gà rán,trẻ em,OA'),

  -- ── Hoạt động · Nha Trang ────────────────────────────────────────────
  ('3964302494973401385', 'Thầy Vinh Dạy Bơi Nha Trang', 'ACTIVITY', 'Nha Trang',
   'Lớp bơi cá nhân tại bãi biển Nha Trang (Mini App)',
   'https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1600&q=85',
   'https://zalo.me/s/3964302494973401385/', 'bơi,trẻ em,mini app'),

  ('1144938570296923407', 'Nha Trang Swimming Coaches', 'ACTIVITY', 'Nha Trang',
   'Đội ngũ HLV dạy bơi biển (Mini App)',
   'https://images.unsplash.com/photo-1560090995-01632a28895b?w=1600&q=85',
   'https://zalo.me/s/1144938570296923407/', 'bơi,nhóm,mini app')

ON CONFLICT (oa_id) DO UPDATE SET
  name        = EXCLUDED.name,
  category    = EXCLUDED.category,
  city        = EXCLUDED.city,
  description = EXCLUDED.description,
  avatar_url  = EXCLUDED.avatar_url,
  deeplink    = EXCLUDED.deeplink,
  tags        = EXCLUDED.tags;

-- Nghiệm thu nhanh
SELECT category, count(*), string_agg(left(name, 22), ' · ') AS vd
FROM partner_oas GROUP BY category ORDER BY category;
