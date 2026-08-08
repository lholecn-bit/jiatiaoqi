#!/usr/bin/env bash
set -euo pipefail

# 夹挑棋一键部署脚本（Ubuntu/Debian）
# 用法（推荐）：
#   sudo bash deploy.sh --domain game.example.com --app-dir /srv/jiaotiaoqi --ws-port 8080 --web-port 80
#
# 开发机本地快速部署：
#   sudo bash deploy.sh --domain 127.0.0.1 --app-dir /home/$USER/Project/ChessGame

DOMAIN=""
APP_DIR="/srv/jiaotiaoqi"
WS_PORT="8080"
WEB_PORT="80"
NODE_MAJOR="20"

print_help() {
  cat <<EOF
Usage: sudo bash deploy.sh [options]

Options:
  --domain <domain>       站点域名或IP（必填）
  --app-dir <path>        项目部署目录（默认: /srv/jiaotiaoqi）
  --ws-port <port>        WebSocket 服务端口（默认: 8080）
  --web-port <port>       Nginx 监听端口（默认: 80）
  --node-major <version>  Node 大版本（默认: 20）
  -h, --help              显示帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:-}"
      shift 2
      ;;
    --ws-port)
      WS_PORT="${2:-}"
      shift 2
      ;;
    --web-port)
      WEB_PORT="${2:-}"
      shift 2
      ;;
    --node-major)
      NODE_MAJOR="${2:-}"
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1"
      print_help
      exit 1
      ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "[ERROR] --domain 必填"
  print_help
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] 请使用 sudo/root 执行"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/8] 安装系统依赖..."
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release nginx git

echo "[2/8] 安装 Node.js ${NODE_MAJOR}.x（若已安装则跳过）..."
if ! command -v node >/dev/null 2>&1; then
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

echo "[3/8] 安装 PM2..."
npm install -g pm2

echo "[4/8] 准备应用目录..."
mkdir -p "$APP_DIR"
rsync -a --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "archive" \
  --exclude "docs" \
  --exclude "patent" \
  "$SCRIPT_DIR/" "$APP_DIR/"

cd "$APP_DIR"

echo "[5/8] 安装 Node 依赖..."
npm install --production

echo "[6/8] 启动 WebSocket 服务..."
pm2 delete jiaotiaoqi-ws >/dev/null 2>&1 || true
PORT="$WS_PORT" pm2 start online-server.js --name jiaotiaoqi-ws
pm2 save

if command -v systemctl >/dev/null 2>&1; then
  PM2_STARTUP_CMD="$(pm2 startup systemd -u root --hp /root | tail -n 1)"
  if [[ "$PM2_STARTUP_CMD" == sudo* ]]; then
    bash -lc "${PM2_STARTUP_CMD#sudo }" || true
  fi
fi

echo "[7/8] 生成 Nginx 站点配置..."
cat > /etc/nginx/sites-available/jiaotiaoqi.conf <<EOF
server {
    listen ${WEB_PORT};
    server_name ${DOMAIN};

    root ${APP_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /ws {
        proxy_pass http://127.0.0.1:${WS_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
EOF

ln -sf /etc/nginx/sites-available/jiaotiaoqi.conf /etc/nginx/sites-enabled/jiaotiaoqi.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
systemctl enable nginx

echo "[8/8] 完成"
cat <<EOF

部署完成 ✅

前端地址：
  http://${DOMAIN}${WEB_PORT:+:${WEB_PORT}}

在线模式 WebSocket 地址（前端在线模式填写）：
  ws://${DOMAIN}${WEB_PORT:+:${WEB_PORT}}/ws

常用命令：
  pm2 ls
  pm2 logs jiaotiaoqi-ws
  pm2 restart jiaotiaoqi-ws

如果你使用 HTTPS，请将前端在线地址改为：
  wss://${DOMAIN}/ws
并用 certbot 为 Nginx 配置证书。
EOF
