const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { auth } = require('../middleware/auth');

const router = express.Router();
const FORBIDDEN_SELF_REGISTER_ROLES = new Set(['admin', 'dept_admin']);
const ALLOWED_ROLES = new Set(['admin', 'dept_admin', 'applicant', 'warehouse']);

router.post('/register', async (req, res) => {
  const { email, password, name, role = 'warehouse' } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ message: '이메일과 비밀번호는 필수입니다.' });
    }

    const { User } = global.sequelize.models;
    
    // 중복 확인
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: '이미 등록된 이메일입니다.' });
    }

    const normalizedRole = String(role || 'warehouse').trim();
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      return res.status(400).json({ message: '허용되지 않은 역할입니다.' });
    }
    if (FORBIDDEN_SELF_REGISTER_ROLES.has(normalizedRole)) {
      return res.status(403).json({ message: '해당 역할은 공개 회원가입으로 생성할 수 없습니다.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      password: hashedPassword,
      name: name || email,
      role: normalizedRole
    });

    const token = jwt.sign({
      id: user.id,
      role: user.role,
      deptId: user.deptId || null,
      warehouseId: user.warehouseId || null
    }, process.env.JWT_SECRET);
    
    res.status(201).json({
      message: '가입이 완료되었습니다.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        deptId: user.deptId || null,
        warehouseId: user.warehouseId || null,
        warehouse: '본사창고'
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
    }

    const { User } = global.sequelize.models;
    const user = await User.findOne({ where: { email } });

    if (!user) {
      return res.status(401).json({ message: '등록되지 않은 이메일입니다.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: '비밀번호가 맞지 않습니다.' });
    }

    const token = jwt.sign({
      id: user.id,
      role: user.role,
      deptId: user.deptId || null,
      warehouseId: user.warehouseId || null
    }, process.env.JWT_SECRET);

    res.json({
      message: '로그인되었습니다.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        deptId: user.deptId || null,
        warehouseId: user.warehouseId || null,
        warehouse: '본사창고'
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || '로그인 처리 중 오류가 발생했습니다.' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const { User } = global.sequelize.models;
    const user = await User.findByPk(req.user.id, { attributes: { exclude: ['password'] } });
    if (!user) {
      return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        deptId: user.deptId || null,
        warehouseId: user.warehouseId || null,
        warehouse: '본사창고'
      }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || '조회 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
