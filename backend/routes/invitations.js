const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt    = require('bcryptjs');
const nodemailer = require('nodemailer');
const { auth, roleAuth } = require('../middleware/auth');

const router = express.Router();

// ── 메일 전송 유틸 ──────────────────────────────────────────────────
function getTransporter() {
  if (!process.env.SMTP_HOST) return null; // dev mode

  const port = parseInt(process.env.SMTP_PORT) || 25;
  const isPort465 = port === 465;

  const config = {
    host:   process.env.SMTP_HOST,
    port,
    secure: isPort465,            // 465=SSL, 25/587=plain
    tls: {
      rejectUnauthorized: false,  // 자체 서명 인증서 허용
    },
  };

  // 포트 25는 대부분 인증 없는 릴레이 — SMTP_PASS가 있을 때만 auth 추가
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    config.auth = {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    };
  }

  // 포트 25는 STARTTLS 강제 안 함
  if (port === 25) {
    config.ignoreTLS = true;
  }

  return nodemailer.createTransport(config);
}

async function sendInviteEmail(to, role, link, inviterName) {
  const ROLE_KR = { admin:'시스템관리자', dept_admin:'부서관리자', warehouse:'창고작업자', applicant:'신청자' };
  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;background:#0d1117;color:#e6edf3;padding:32px;border-radius:10px">
      <h2 style="color:#58a6ff;margin-top:0">📦 DS WMS 가입 초대</h2>
      <p>${inviterName} 관리자가 창고 관리 시스템에 초대했습니다.</p>
      <p style="background:#161b22;padding:12px 16px;border-radius:6px;border-left:3px solid #58a6ff">
        배정 역할: <strong style="color:#58a6ff">${ROLE_KR[role] || role}</strong>
      </p>
      <p>아래 버튼을 클릭하여 이름과 비밀번호를 설정하면 가입이 완료됩니다.<br>
      관리자 최종 승인 후 로그인이 가능합니다.</p>
      <a href="${link}" style="display:inline-block;background:#1158b7;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0">
        초대 수락하기
      </a>
      <p style="color:#8b949e;font-size:12px;margin-top:24px">
        링크는 <strong>7일</strong> 후 만료됩니다.<br>
        이 메일을 요청하지 않았다면 무시하세요.
      </p>
    </div>
  `;

  const transporter = getTransporter();
  if (!transporter) {
    // dev mode: 콘솔에 출력
    console.log('\n📧 [DEV] 초대 이메일 (실제 발송 안됨)');
    console.log(`   받는 사람: ${to}`);
    console.log(`   초대 링크: ${link}\n`);
    return { dev: true, link };
  }

  try {
    await transporter.sendMail({
      from: `"DS WMS" <${process.env.SMTP_USER}>`,
      to,
      subject: '[DS WMS] 창고 관리 시스템 가입 초대',
      html,
    });
    console.log(`📧 초대 이메일 발송 완료 → ${to}`);
    return { sent: true };
  } catch (err) {
    console.error('📧 이메일 발송 실패:', err.message);
    // 발송 실패해도 초대는 생성 — 링크를 dev 모드처럼 반환
    return { dev: true, link, error: err.message };
  }
}

function canAssignRole(inviterRole, targetRole) {
  if (inviterRole === 'admin') return true;
  if (inviterRole === 'dept_admin') {
    return !['admin', 'dept_admin'].includes(targetRole);
  }
  return false;
}

const ALLOWED_ROLES = new Set(['admin', 'dept_admin', 'applicant', 'warehouse']);

function parseNullableInt(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { error: `${fieldName} 값이 올바르지 않습니다.` };
  return { value: n };
}

async function resolveDeptAndWarehouse({ req, targetRole, requestedDeptId, requestedWarehouseId }) {
  const { Warehouse } = global.sequelize.models;
  let resolvedDeptId = req.user.role === 'dept_admin' ? req.user.deptId : requestedDeptId;
  let resolvedWarehouseId = requestedWarehouseId;

  if (targetRole === 'dept_admin' && !resolvedDeptId) {
    return { status: 400, error: '부서관리자 초대 시 소속 부서 지정이 필요합니다.' };
  }

  if (targetRole === 'warehouse') {
    if (!resolvedWarehouseId) {
      return { status: 400, error: '창고작업자 초대 시 소속 창고 선택이 필요합니다.' };
    }

    const warehouse = await Warehouse.findByPk(resolvedWarehouseId);
    if (!warehouse) return { status: 400, error: '선택한 창고를 찾을 수 없습니다.' };
    if (!warehouse.deptId) return { status: 400, error: '선택한 창고에 소속 부서가 지정되지 않았습니다.' };

    if (req.user.role === 'dept_admin' && warehouse.deptId !== req.user.deptId) {
      return { status: 403, error: '부서관리자는 본인 부서 창고만 초대할 수 있습니다.' };
    }
    if (resolvedDeptId && warehouse.deptId !== resolvedDeptId) {
      return { status: 400, error: '선택한 창고가 소속 부서와 일치하지 않습니다.' };
    }

    resolvedDeptId = resolvedDeptId || warehouse.deptId;
  } else {
    resolvedWarehouseId = null;
  }

  return { deptId: resolvedDeptId, warehouseId: resolvedWarehouseId };
}

// ── 초대 발송 (Admin / Dept Admin) ─────────────────────────────────
// POST /api/invitations
router.post('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const { email, role = 'warehouse', deptId, warehouseId } = req.body;
  if (!email) return res.status(400).json({ error: '이메일을 입력하세요' });
  if (!ALLOWED_ROLES.has(role)) return res.status(400).json({ error: '허용되지 않은 역할입니다.' });
  if (!canAssignRole(req.user.role, role)) {
    return res.status(403).json({ error: '부서관리자는 시스템/부서 관리자 권한을 초대할 수 없습니다.' });
  }
  if (req.user.role === 'dept_admin' && !req.user.deptId) {
    return res.status(403).json({ error: '부서가 지정되지 않은 부서관리자 계정입니다.' });
  }
  const parsedDept = parseNullableInt(deptId, 'deptId');
  if (parsedDept.error) return res.status(400).json({ error: parsedDept.error });
  const parsedWarehouse = parseNullableInt(warehouseId, 'warehouseId');
  if (parsedWarehouse.error) return res.status(400).json({ error: parsedWarehouse.error });

  const resolved = await resolveDeptAndWarehouse({
    req,
    targetRole: role,
    requestedDeptId: parsedDept.value,
    requestedWarehouseId: parsedWarehouse.value,
  });
  if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });

  const { User, Invitation } = global.sequelize.models;

  // 이미 가입된 이메일 확인
  const existUser = await User.findOne({ where: { email } });
  if (existUser) return res.status(400).json({ error: '이미 가입된 이메일입니다' });

  // 이미 유효한 초대가 있는지 확인
  const { Op } = require('sequelize');
  const existInvite = await Invitation.findOne({
    where: { email, status: ['invited', 'pending'], expiresAt: { [Op.gt]: new Date() } },
  });
  if (existInvite) return res.status(400).json({ error: '이미 발송된 초대가 있습니다' });

  const token     = uuidv4().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7일

  const invitation = await Invitation.create({
    email, role, deptId: resolved.deptId, warehouseId: resolved.warehouseId, token, expiresAt,
    invitedBy: req.user.id,
    status: 'invited',
  });

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const link = `${frontendUrl}?invite=${token}`;

  const inviter = await User.findByPk(req.user.id);
  const emailResult = await sendInviteEmail(email, role, link, inviter?.name || '관리자');

  const failed = emailResult.dev && emailResult.error;
  res.status(201).json({
    message: failed
      ? `초대가 생성됐지만 이메일 발송에 실패했습니다: ${emailResult.error}`
      : '초대 이메일이 발송됐습니다',
    invitation: { id: invitation.id, email, role, deptId: invitation.deptId || null, warehouseId: invitation.warehouseId || null, expiresAt },
    ...(emailResult.dev ? { devLink: link } : {}),
  });
});

// ── 토큰 검증 (공개) ────────────────────────────────────────────────
// GET /api/invitations/validate/:token
router.get('/validate/:token', async (req, res) => {
  const { Invitation } = global.sequelize.models;
  const { Op } = require('sequelize');

  const inv = await Invitation.findOne({
    where: {
      token: req.params.token,
      status: 'invited',
      expiresAt: { [Op.gt]: new Date() },
    },
  });

  if (!inv) return res.status(404).json({ error: '유효하지 않거나 만료된 초대 링크입니다' });

  res.json({ email: inv.email, role: inv.role });
});

// ── 초대 수락 (공개) — 이름/비밀번호 설정 ─────────────────────────
// POST /api/invitations/accept/:token
router.post('/accept/:token', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: '이름과 비밀번호를 입력하세요' });
  if (password.length < 6)  return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다' });

  const { Invitation } = global.sequelize.models;
  const { Op } = require('sequelize');

  const inv = await Invitation.findOne({
    where: {
      token: req.params.token,
      status: 'invited',
      expiresAt: { [Op.gt]: new Date() },
    },
  });

  if (!inv) return res.status(404).json({ error: '유효하지 않거나 만료된 초대 링크입니다' });

  const passwordHash = await bcrypt.hash(password, 10);
  await inv.update({ name, passwordHash, status: 'pending' });

  res.json({ message: '정보가 제출됐습니다. 관리자 승인 후 로그인 가능합니다.' });
});

// ── 초대 목록 조회 (Admin / Dept Admin) ─────────────────────────────
// GET /api/invitations
router.get('/', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const { Invitation, User } = global.sequelize.models;
  const where = req.user.role === 'dept_admin' ? { invitedBy: req.user.id } : {};

  const list = await Invitation.findAll({
    where,
    order: [['createdAt', 'DESC']],
    include: [{ model: User, as: 'inviter', foreignKey: 'invitedBy', attributes: ['name'], required: false }],
  });

  res.json(list);
});

// ── 승인 (Admin / Dept Admin with scope) ────────────────────────────
// PUT /api/invitations/:id/approve
router.put('/:id/approve', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const { Invitation, User } = global.sequelize.models;

  const inv = await Invitation.findByPk(req.params.id);
  if (!inv)               return res.status(404).json({ error: '초대를 찾을 수 없습니다' });
  if (inv.status !== 'pending') return res.status(400).json({ error: '승인 대기 상태가 아닙니다' });
  if (!inv.name)          return res.status(400).json({ error: '사용자가 아직 정보를 입력하지 않았습니다' });
  if (req.user.role === 'dept_admin') {
    if (inv.invitedBy !== req.user.id) return res.status(403).json({ error: '본인이 초대한 대상만 승인할 수 있습니다.' });
    if (!canAssignRole(req.user.role, inv.role)) {
      return res.status(403).json({ error: '부서관리자는 해당 권한의 가입을 승인할 수 없습니다.' });
    }
  }

  // 이미 가입된 이메일 체크
  const exists = await User.findOne({ where: { email: inv.email } });
  if (exists) {
    await inv.update({ status: 'approved', approvedBy: req.user.id });
    return res.status(400).json({ error: '이미 가입된 이메일입니다' });
  }

  const inviter = inv.invitedBy ? await User.findByPk(inv.invitedBy) : null;
  const user = await User.create({
    email:    inv.email,
    password: inv.passwordHash,
    name:     inv.name,
    role:     inv.role,
    deptId:   inv.deptId || inviter?.deptId || null,
    warehouseId: inv.role === 'warehouse' ? (inv.warehouseId || null) : null,
  });

  await inv.update({ status: 'approved', approvedBy: req.user.id });

  const userResponse = user.toJSON();
  delete userResponse.password;
  res.json({ message: `${inv.name} 님의 가입이 승인됐습니다`, user: userResponse });
});

// ── 거절 (Admin / Dept Admin with scope) ────────────────────────────
// PUT /api/invitations/:id/reject
router.put('/:id/reject', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const { Invitation } = global.sequelize.models;
  const { reason = '' } = req.body;

  const inv = await Invitation.findByPk(req.params.id);
  if (!inv) return res.status(404).json({ error: '초대를 찾을 수 없습니다' });
  if (req.user.role === 'dept_admin' && inv.invitedBy !== req.user.id) {
    return res.status(403).json({ error: '본인이 초대한 대상만 거절할 수 있습니다.' });
  }

  await inv.update({ status: 'rejected', rejectionReason: reason });
  res.json({ message: '거절 처리됐습니다' });
});

// ── 초대 재발송 (Admin / Dept Admin with scope) ─────────────────────
// POST /api/invitations/:id/resend
router.post('/:id/resend', auth, roleAuth(['admin', 'dept_admin']), async (req, res) => {
  const { Invitation, User } = global.sequelize.models;

  const inv = await Invitation.findByPk(req.params.id);
  if (!inv) return res.status(404).json({ error: '초대를 찾을 수 없습니다' });
  if (req.user.role === 'dept_admin') {
    if (inv.invitedBy !== req.user.id) return res.status(403).json({ error: '본인이 초대한 대상만 재발송할 수 있습니다.' });
    if (!canAssignRole(req.user.role, inv.role)) {
      return res.status(403).json({ error: '부서관리자는 해당 권한의 초대를 재발송할 수 없습니다.' });
    }
  }

  const newToken  = uuidv4().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await inv.update({ token: newToken, expiresAt, status: 'invited', name: null });

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const link = `${frontendUrl}?invite=${newToken}`;

  const inviter = await User.findByPk(req.user.id);
  const emailResult = await sendInviteEmail(inv.email, inv.role, link, inviter?.name || '관리자');

  res.json({
    message: '초대 이메일이 재발송됐습니다',
    ...(emailResult.dev ? { devLink: link } : {}),
  });
});

// Invitation → User (inviter) 관계
// server.js 에서 sync 이후에 설정되므로 여기서는 include alias 사용 안 함

module.exports = router;
