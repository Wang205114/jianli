# 部署说明

这个项目是一个标准的 Node Web Service：

- 前端页面：`index.html` + `app.js` + `styles.css`
- 后端服务：`server.js`
- 健康检查：`GET /healthz`

推荐优先部署到：

- 阿里云轻量应用服务器 / ECS
- 腾讯云轻量应用服务器 / CVM

如果你的比赛更看重中国大陆访问稳定性，这两类云服务器会比海外平台更合适。

## 1. 运行环境

建议环境：

- Ubuntu 22.04 LTS
- Node.js 20 及以上
- npm 10 及以上

## 2. 环境变量

至少配置：

- `DEEPSEEK_API_KEY`

可选：

- `DEEPSEEK_MODEL=deepseek-chat`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`

你可以复制项目根目录的 `.env.example`，再改成正式的 `.env` 或 `.env.local`。

## 3. 方式一：直接用 Node 启动

1. 上传代码到服务器
2. 进入项目目录
3. 执行 `npm install`
4. 配置环境变量
5. 执行 `npm start`

启动后默认监听：

- `http://服务器IP:3000`

建议配合 `pm2` 或 `systemd` 做守护。

## 4. 方式二：Docker 部署

项目根目录已提供 `Dockerfile`，可直接构建镜像：

1. `docker build -t resume-roaster .`
2. `docker run -d -p 3000:3000 --env-file .env --name resume-roaster resume-roaster`

如果你后续要接入阿里云容器服务或腾讯云容器服务，这种方式更方便。

## 5. Nginx 反向代理建议

正式演示建议使用：

- `Nginx + Node`
- 域名 + HTTPS

Nginx 将 80/443 转发到本地 `3000` 端口即可。

## 6. 部署后验证

先检查：

- 首页：`http://你的域名/`
- 健康检查：`http://你的域名/healthz`

再验证业务流程：

1. 生成简历页面是否正常显示
2. AI 优化是否可以返回结果
3. PDF 诊断是否可用
4. PDF 导出是否可用

## 7. 比赛前建议

- 使用你自己的正式域名，不要直接展示服务器 IP
- 提前配置 HTTPS
- 准备一份示例 PDF 和一份示例 JD
- 用正式 API Key 完整跑一遍所有流程
- 比赛前一天不要再改核心逻辑，只做小修正
