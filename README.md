# GitHub Projects MCP Server

GitHub Projects V2の包括的な管理機能を提供するModel Context Protocol (MCP) サーバーです。

## 機能

### プロジェクト管理
- **プロジェクト一覧取得** (`list-projects`): ユーザーまたは組織のGitHub Projectsを一覧表示
- **プロジェクト詳細取得** (`get-project`): プロジェクトの詳細情報、フィールド、アイテムを取得
- **プロジェクト作成** (`create-project`): 新しいGitHub Projectを作成
- **プロジェクト更新** (`update-project`): 既存のプロジェクトの情報を更新

### プロジェクト構造管理
- **フィールド情報取得** (`get-project-fields`): プロジェクトの全フィールド詳細を取得
- **フィールド作成** (`create-project-field`): プロジェクトに新しいフィールドを追加
- **フィールド値更新** (`update-project-item`): プロジェクトアイテムのフィールド値を更新

### アイテム管理
- **アイテム一覧取得** (`get-project-items`): プロジェクト内の全アイテムと現在の値を取得
- **アイテム追加** (`add-item-to-project`): 既存のIssueやPRをプロジェクトに追加
- **Issue作成** (`create-issue`): GitHubのIssueを作成し、オプションでプロジェクトに追加
- **ステータス更新** (`update-item-status`): アイテムのステータスを簡単に更新

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. GitHub認証の設定

`.env`または`.env.local`ファイルにGitHubのPersonal Access Tokenを設定:

```bash
# .env.local（優先）または .env
GITHUB_TOKEN="your_github_token_here"
```

必要な権限:
- `repo` - リポジトリアクセス
- `project` - GitHub Projects V2アクセス
- `write:org` - 組織プロジェクト（組織のプロジェクトを管理する場合）

### 3. プロジェクトのビルド

```bash
npm run build
```

### 4. Claude Codeでの設定

ターミナルで以下を実行

```bash
claude mcp add github-projects -e GITHUB_TOKEN=XXXXXXXX -- node /Users/xxxxx/works/github-projects-mcp/build/index.js
```

**注意**: `.env`ファイルを使用する場合、環境変数は自動的に読み込まれます。