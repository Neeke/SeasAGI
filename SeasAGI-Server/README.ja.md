> [English](README.md) · **日本語** · [한국어](README.ko.md) · [简体中文](README.zh.md)

# SeasAGI Server Community

[![Build status](https://ci.appveyor.com/api/projects/status/github/SeasX/SeasAGI?svg=true)](https://ci.appveyor.com/project/SeasX/SeasAGI)
[![macOS](https://img.shields.io/badge/platform-macOS-blue)](https://github.com/SeasX/SeasAGI)
[![Linux](https://img.shields.io/badge/platform-Linux-blue)](https://github.com/SeasX/SeasAGI)
[![Windows](https://img.shields.io/badge/platform-Windows-blue)](https://github.com/SeasX/SeasAGI)
[![License](https://img.shields.io/badge/license-AGPL%20v3-green)](LICENSE)

コミュニティ版クラウドサブプロジェクトです。オープンソースのプラットフォームコントロールプレーンとプラットフォーム中継ゲートウェイを含みます。エンタープライズガバナンス、課金、管理画面は含みません。

## ディレクトリ構造

```text
SeasAGI-Server/
├── README.md
├── README.ja.md
├── README.ko.md
├── scripts/
│   └── build.sh
├── deploy/
│   ├── build.sh
│   ├── install.sh
│   ├── nginx.conf
│   └── systemd/
├── platform-api/
└── relay-gateway/
```

## 責務

- `platform-api`: コミュニティ版クラウドコントロールプレーン — 基本認証、チャンネル管理、基本 Combo CRUD、基本使用量統計、テナント管理 API
- `relay-gateway`: コミュニティ版中継データプレーン — リレー、マルチモーダル転送、ヘルスチェック、トレース、運用インターフェース
- `deploy`: コミュニティ版デプロイ、インストール、systemd、nginx、運用スクリプト
- `scripts/build.sh`: コミュニティ版統一ビルドエントリポイント

## コミュニティ版の範囲

### 含まれる機能

- 基本認証: ログイン / 登録 / トークン更新
- 基本チャンネル管理: プラットフォームチャンネルの CRUD
- 基本 Combo: ユーザーレベル Combo CRUD + 公式テンプレート取得
- 基本使用量: ユーザー使用量、モデル/チャンネル別グループ、タイムライン、エラー分布、最近のエラー
- 基本テナント管理: メンバー、招待リンク、カスタムチャンネル同期、ポリシー、テンプレート、設定スナップショット
- 基本 Admin API: ユーザー / プラン / チャンネル / Combo / Relay Gateway の基本管理
- Relay 基本転送: リクエスト透過転送、ヘルスチェック、レート制限、トレース

### 含まれない機能

以下の機能はエンタープライズプロジェクト `SeasAGI-Server-Enterprise/` に移動されました：

- Stripe 課金 & Checkout Session
- プラン駆動の商用機能ゲーティング
- マルチテナント請求 / 注文 / 支払い / 請求書
- Combo ガバナンス（可視性ポリシー、デプロイ承認）
- Combo メトリクス観測 & Provider 健全性指標
- エンタープライズ BYOK 二層フォールバック戦略
- エンタープライズ SSO / SCIM / コンプライアンス / 監査強化 / SLA / ライセンス
- 管理画面フロントエンド `src-admin`

## よく使うコマンド

```bash
# コミュニティ版クラウドプロジェクトをビルド
bash SeasAGI-Server/scripts/build.sh

# Linux サーバーにインストール
sudo bash SeasAGI-Server/deploy/install.sh
```

## ビルド成果物

- `SeasAGI-Server/build/platform-api`
- `SeasAGI-Server/build/relay-gateway`

## 設定

すべての設定は環境変数から読み込まれます。`deploy/.env.example` を参考に `.env` ファイルを作成してエクスポートしてください：

```bash
export $(grep -v '^#' deploy/.env.example | xargs)
```

### コア設定

| 変数 | 説明 | デフォルト値 |
|------|------|-------------|
| `API_PORT` | プラットフォーム API のリッスンポート | `9318` |
| `RELAY_PORT` | 中継ゲートウェイのポート | `8318` |
| `DB_PATH` | SQLite データベースのパス | `~/.seasagi/platform-api.db` |
| `JWT_SECRET` | JWT 署名シークレット（本番環境では必須） | — |
| `JWT_REFRESH_SECRET` | JWT リフレッシュトークンシークレット（本番環境では必須） | — |
| `ADMIN_SECRET` | 管理者ログインシークレット | — |
| `CORS_ALLOW_ORIGIN` | CORS 許可オリジン | — |
| `SEASAGI_DATA_KEY` | 機密データ暗号化キー | — |

## ライセンス

コミュニティ版は `AGPL 3.0` でライセンスされます。完全なエンタープライズ機能については `SeasAGI-Server-Enterprise/` を参照してください。
