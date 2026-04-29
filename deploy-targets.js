/**
 * deploy-targets.js — dev-tools 와 backend/routes/update.js 가 공유하는 배포 경로 설정
 * ROOT 는 호출하는 쪽에서 주입
 */
const path = require('path');

function getDeployTargets(ROOT) {
  return [
    {
      base:    path.join(ROOT, 'backend'),
      prefix:  'backend',
      exclude: ['node_modules', '.env', 'uploads', '.env.example'],
    },
    {
      base:    path.join(ROOT, 'frontend', 'build'),
      prefix:  'frontend/build',
      exclude: [],
    },
  ];
}

module.exports = { getDeployTargets };
