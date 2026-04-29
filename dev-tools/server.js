const express = require('express');
const path    = require('path');
const dotenv  = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../backend/.env') });

// 개발자 모드가 아니면 실행 거부
if (process.env.APP_MODE !== 'developer') {
  console.error('[dev-tools] APP_MODE=developer 가 아닙니다. 실행을 중단합니다.');
  process.exit(1);
}

const app = express();
app.use(express.json());

// 개발자 도구 UI
app.use(express.static(path.join(__dirname, 'public')));

// 릴리즈 API
app.use('/api/release', require('./routes/release'));

const PORT = process.env.DEV_TOOLS_PORT || 5001;
app.listen(PORT, () => {
  console.log(`[dev-tools] 개발자 도구 실행 중: http://localhost:${PORT}`);
});
