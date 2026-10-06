# EDL 環境モニター

Arduino R4 WiFi → HTTPS PHP API → ファイル保存 → React ダッシュボード。SQL不要です。
既存React/Vite構成を引き継ぎ、表示・履歴・設定を個別コンポーネントに分割しています。

## ローカル検証と配布

```powershell
cd EDL-website
npm ci
npm run lint
npm run build
cd ..
python tests/security-integration.py --php php
python tests/integration-firmware.py --firmware ../engineering_design_laboratory --compiler clang++ --php php
node deploy/build.mjs
```

`release/public`だけをApache公開域にします。`release/private`と`release/bin`は兄弟ディレクトリに保持します。
ビルドだけでは受信APIは動きません。PHPファイルとcronも配置してください。
開発用HTTPは `EDL_ALLOW_HTTP=1` とループバックIPの組み合わせでのみ許可されます。本番に設定しないでください。

## あなたがサーバーで実行する配置手順

1. DNSに `edl-site.ricky17.com` のAレコードを追加します。
2. `release`の内容をSSH/FTPで `/opt/edl` に配置。コードの所有者をroot等の配置用ユーザーにして、www-dataから書込不可にします。
3. PHPとApacheモジュールを確認します。既存mod_phpを利用し、必要なら `sudo apt install libapache2-mod-php php-cli libapache2-mod-evasive certbot python3-certbot-apache`、`sudo a2enmod ssl headers reqtimeout evasive`。これは既存サイトにも影響するため設定を見比べて実行してください。
4. `sudo install -d -o www-data -g www-data -m 700 /var/lib/edl`。
5. `sudo -u www-data php /opt/edl/bin/setup.php /var/lib/edl`。管理パスワード（8文字以上）を入力します。画面に入力が見えるので私的な端末で実行してください。hashは `/var/lib/edl/pass`、送信キーは `/var/lib/edl/config.json` に生成します。表示された送信キーをArduinoローカル設定にコピーします。秘密情報はGitやpublicへ置かないでください。
6. 証明書発行前は443設定を有効化せず、既存HTTP設定等でドメインを到達可能にし `sudo certbot certonly --apache -d edl-site.ricky17.com`。取得後 `deploy/edl-site.conf` を `/etc/apache2/sites-available/edl-site.conf` に配置、`sudo a2ensite edl-site`、`sudo apache2ctl configtest`、成功後 `sudo systemctl reload apache2`。
7. `deploy/edl.cron`を `/etc/cron.d/edl`へroot所有0644で配置。`deploy/edl.logrotate`を `/etc/logrotate.d/edl`へ配置。`sudo touch /var/log/edl-aggregate.log` と `sudo chown www-data:adm /var/log/edl-aggregate.log`。
8. `curl https://edl-site.ricky17.com/api/latest.php`、管理ログイン、Arduino送信、次の履歴保存を実機で確認します。WiFiホットスポットは2.4GHzを利用してください。

## 保存・表示の仕様

- 測定送信10秒、画面更新10秒、履歴画面更新60秒。非表示タブでは更新停止。
- 初期保存30分、WebUIで整数1〜60分へ変更。進行中の集計窓は元の間隔で閉じ、次の窓から新設定になります。cronは毎分なので保存時刻に最大約1分の遅れがあります。
- 日別JSONLは日本時間のファイル名で1年間保存。UIは直近7日・最大10080件。長期履歴はサーバーの `history/YYYY-MM-DD.jsonl` を私的に取得できます。
- server受信日時を正式時刻とします。無効値はnull、有効件数0では平均値もnull。通信切断から60秒で更新待ち表示。古い最新値を繰返し集計しません。
- 評価は既存Arduinoの1〜8段階の式。eCO2は実CO2ではなく推定、騒音は校正されていない換算値です。
- 全公開＋noindex。URLを知っている人に限定するアクセス認証ではなく、URL共有で閲覧可能です。

## セキュリティと負荷

設定のみ共通パスワード認証。PHP password_hash/pass、セッション更新、1時間TTL、HttpOnly/Secure/SameSite Strict Cookie、CSRF、ログアウト、ログイン5回/5分制限を使用します。
受信APIは32文字以上の専用キー必須。device_id固定、2048byte上限、値型/範囲/nullとvalidity一致を検証します。
履歴は事前生成キャッシュ、期間は1〜7日固定。API頻度制限はIPを256固定bucketへ写像し、攻撃時のファイル増殖を抑えます。bucket衝突時は別閲覧者も制限を共有し得ます。
Apacheのmod_evasiveがF5連打と短時間アクセスを抑制します。設定例は同一IP（モバイル/学校NAT）で共有される点に注意してください。mod_evasive無しでは静的ページへの連打に入口制限が適用されません。導入・有効化を確認してください。
容量設定例 `edl-capacity.conf.example` は全VirtualHostに影響します。CPU/メモリを見て既存値を比較し、MaxRequestWorkersを調整してください。単一Apacheでは帯域を埋める大規模DDoSの防止保証はできません。

ファイル操作はロック・atomic rename・集計window_id重複抑止を使用します。ただしファイル保存はDBのトランザクションと同等ではなく、電源断や途中書込などで復旧が必要になることがあります。private保存域を定期バックアップしてください。Apacheアクセスログ・保存容量も監視対象です。

容量不足や権限異常で頻度制限ファイルが破損した場合は、安全側に倒して503を返します。
原因を解消した後、ログで特定した `/var/lib/edl/rate` 内の該当ファイルだけを削除すると、その制限状態を再生成できます。
履歴・秘密情報・設定ファイルは削除しないでください。

ビルドと検証済みの範囲、配置後の実機確認項目は `docs/verification.md` に記載しています。
