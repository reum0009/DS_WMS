const jwt = require('jsonwebtoken');

const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '토큰이 필요합니다' });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    return res.status(401).json({ error: '유효하지 않은 토큰입니다' });
  }
};

const roleAuth = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: `접근 권한이 없습니다. 필요한 역할: ${roles.join(', ')}` });
  }
  next();
};

// 요청 소유권 검증 - applicant는 자신의 요청만 조회/수정/삭제 가능
const verifyRequestOwnership = async (req, res, next) => {
  try {
    const { Request } = global.sequelize.models;
    const request = await Request.findByPk(req.params.id);
    
    if (!request) {
      return res.status(404).json({ error: '요청을 찾을 수 없습니다' });
    }
    
    // Admin은 모든 요청에 접근 가능
    if (req.user.role === 'admin') {
      return next();
    }
    
    // Applicant는 자신의 요청만 접근 가능
    if (req.user.role === 'applicant' && request.applicantId !== req.user.id) {
      return res.status(403).json({ error: '자신의 요청만 조회할 수 있습니다' });
    }
    
    // Approver/Releaser인 경우 pending 또는 approved 상태의 요청만 접근 가능
    if (['approver', 'releaser'].includes(req.user.role)) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        return next(); // 조회는 허용
      }
      if (!['pending', 'approved'].includes(request.status)) {
        return res.status(403).json({ error: `${request.status} 상태의 요청은 처리할 수 없습니다` });
      }
    }
    
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Admin 전용 작업 검증
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '관리자 권한이 필요합니다' });
  }
  next();
};

module.exports = { auth, roleAuth, verifyRequestOwnership, adminOnly };